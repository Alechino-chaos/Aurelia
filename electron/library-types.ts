export type ReadingView = {
  page: number;
  anchorY: number;
  anchorX: number;
  zoom: number | 'fit';
  panelOpen: boolean;
  panelTab: 'selection' | 'translation' | 'chat' | 'annotations';
};
export type LibraryGroup = {
  id: string;
  name: string;
};
export type LibraryEntry = {
  id: string;
  path: string;
  name: string;
  groupId: string | null;
  documentId: string | null;
  view?: ReadingView;
};
export type LibraryState = {
  version: 1;
  groups: LibraryGroup[];
  entries: LibraryEntry[];
  openIds: string[];
  activeId: string | null;
  mode: 'sidebar' | 'tabs';
  sidebarWidth: number;
  collapsedGroupIds: string[];
  recovery?: {
    source: 'backup' | 'temporary';
    message: string;
  };
};
export type LibraryAction = {
  type: 'group-create';
  name: string;
} | {
  type: 'group-rename';
  id: string;
  name: string;
} | {
  type: 'group-delete';
  id: string;
} | {
  type: 'entry-move';
  id: string;
  groupId: string | null;
} | {
  type: 'entry-remove';
  id: string;
} | {
  type: 'tab-open' | 'tab-activate' | 'tab-close';
  id: string;
} | {
  type: 'mode';
  mode: 'sidebar' | 'tabs';
} | {
  type: 'sidebar';
  width?: number;
  collapsedGroupIds?: string[];
} | {
  type: 'view';
  id: string;
  view: Partial<ReadingView>;
  documentId?: string;
};
export type LibraryOpenedFile = {
  name: string;
  bytes: Uint8Array;
  id: string;
  documentId: string;
  libraryId: string;
  view?: ReadingView;
};
export type LibraryImportResult = {
  state: LibraryState;
  importedIds: string[];
  errors: {
    name: string;
    message: string;
  }[];
};
export type LibraryRelocateResult = {
  state: LibraryState;
  outcome: 'canceled' | 'relocated' | 'existing' | 'mismatch';
  existingId?: string;
  candidateName?: string;
};
