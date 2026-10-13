import Reader from './Reader';
import { Workspace } from './workspace/Workspace';
import { LanguageProvider } from './i18n/LanguageProvider';
import { LanguageGate } from './components/LanguageWelcome';

export default function App() { return <LanguageProvider><LanguageGate>{window.paperdesk ? <Workspace /> : <Reader />}</LanguageGate></LanguageProvider>; }
