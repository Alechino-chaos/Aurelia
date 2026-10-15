import Reader from './Reader';
import { Workspace } from './workspace/Workspace';
import { LanguageProvider } from './i18n/LanguageProvider';
import { LanguageGate } from './components/LanguageWelcome';
import { UpdateProvider } from './updates/UpdateProvider';

export default function App() { return <LanguageProvider><LanguageGate><UpdateProvider>{window.paperdesk ? <Workspace /> : <Reader />}</UpdateProvider></LanguageGate></LanguageProvider>; }
