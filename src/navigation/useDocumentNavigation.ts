import { useEffect, useReducer, useRef } from 'react';
import { NavigationController, type NavigationLanding } from './controller';
import type { NavigationHistory, NavigationPoint } from './history';

export function useDocumentNavigation(identity: unknown, ports: {
  capture(): NavigationPoint; land(point: NavigationLanding, current: () => boolean, restoreZoom: boolean): Promise<boolean>; notify(message: string): void;
}, initial?: NavigationHistory) {
  const [, changed] = useReducer(value => value + 1, 0);
  const latest = useRef(ports); latest.current = ports;
  const owner = useRef<{ identity: unknown; controller: NavigationController } | null>(null);
  if (!owner.current || owner.current.identity !== identity) {
    owner.current?.controller.cancel();
    owner.current = { identity, controller: new NavigationController({ capture: () => latest.current.capture(),
      land: (point, current, restoreZoom) => latest.current.land(point, current, restoreZoom), notify: message => latest.current.notify(message), changed },
    owner.current ? undefined : initial) };
  }
  const controller = owner.current.controller;
  useEffect(() => () => controller.cancel(), [controller]);
  return controller;
}
