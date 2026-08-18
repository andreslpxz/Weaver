import { useEffect, useState } from 'react';
import { ArrowLeft, FileText, MessageSquare, Sparkles, Pencil, Check } from 'lucide-react';
import { useWeaver } from '@/store/weaver';
import * as store from '@/notebooks/store';
import type { Notebook } from '@/notebooks/types';
import { NotebookSourcesPanel } from '@/notebooks/components/NotebookSourcesPanel';
import { NotebookChatPanel } from '@/notebooks/components/NotebookChatPanel';
import { NotebookStudioPanel } from '@/notebooks/components/NotebookStudioPanel';
import { cn } from '@/components/common/Button';

type Tab = 'sources' | 'chat' | 'studio';

export function NotebookDetailView({ notebookId }: { notebookId: string }) {
  const setView = useWeaver((s) => s.setView);
  const [notebook, setNotebook] = useState<Notebook | null>(() => store.getNotebook(notebookId));
  const [tab, setTab] = useState<Tab>('chat');
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(notebook?.name ?? '');

  useEffect(() => {
    setNotebook(store.getNotebook(notebookId));
    const unsub = store.onNotebooksChanged(() => setNotebook(store.getNotebook(notebookId)));
    return unsub;
  }, [notebookId]);

  if (!notebook) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-text-tertiary">
        <p>Este notebook ya no existe.</p>
        <button onClick={() => setView('notebooks')} className="mt-2 text-sm text-accent hover:underline">
          Volver a Notebooks
        </button>
      </div>
    );
  }

  function commitRename() {
    if (nameDraft.trim()) store.renameNotebook(notebook!.id, nameDraft.trim());
    setRenaming(false);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <button
          onClick={() => setView('notebooks')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-app-elevated"
        >
          <ArrowLeft size={16} />
        </button>
        {renaming ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commitRename()}
              onBlur={commitRename}
              className="rounded-md bg-app-elevated border border-border px-2 py-1 text-sm outline-none"
            />
            <button onClick={commitRename} className="text-accent">
              <Check size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setNameDraft(notebook.name);
              setRenaming(true);
            }}
            className="flex items-center gap-1.5 text-sm font-medium text-text-primary hover:text-accent"
          >
            {notebook.name}
            <Pencil size={12} className="text-text-tertiary" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <TabButton active={tab === 'sources'} onClick={() => setTab('sources')} icon={<FileText size={14} />} label="Fuentes" />
        <TabButton active={tab === 'chat'} onClick={() => setTab('chat')} icon={<MessageSquare size={14} />} label="Chat" />
        <TabButton active={tab === 'studio'} onClick={() => setTab('studio')} icon={<Sparkles size={14} />} label="Studio" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'sources' && <NotebookSourcesPanel notebook={notebook} />}
        {tab === 'chat' && <NotebookChatPanel notebook={notebook} />}
        {tab === 'studio' && <NotebookStudioPanel notebook={notebook} />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-sm font-medium transition-colors',
        active
          ? 'border-accent text-accent'
          : 'border-transparent text-text-tertiary hover:text-text-secondary',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
