import Reader from './Reader';
import { Workspace } from './workspace/Workspace';

export default function App() { return window.paperdesk ? <Workspace /> : <Reader />; }
