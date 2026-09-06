import { useState } from 'react';
import { X, Pencil, Check, Send } from 'lucide-react';

export interface AskUserInputArgs {
  question: string;
  options: string[];
  allow_custom?: boolean;
}

export interface InteractivePromptWidgetProps {
  toolCallId: string;
  args: AskUserInputArgs;
  isCompleted: boolean;
  selectedAnswer?: string | null;
  onSubmitResponse: (toolCallId: string, answerText: string) => void;
}

export function InteractivePromptWidget({
  toolCallId,
  args,
  isCompleted,
  selectedAnswer,
  onSubmitResponse,
}: InteractivePromptWidgetProps) {
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customText, setCustomText] = useState('');

  const question = args.question || 'Aclaración requerida:';
  const options = Array.isArray(args.options) ? args.options : [];
  const allowCustom = Boolean(args.allow_custom);

  const handleSelectOption = (opt: string) => {
    if (isCompleted) return;
    onSubmitResponse(toolCallId, opt);
  };

  const handleCustomSubmit = () => {
    if (isCompleted) return;
    const trimmed = customText.trim();
    if (!trimmed) return;
    onSubmitResponse(toolCallId, trimmed);
  };

  const handleSkip = () => {
    if (isCompleted) return;
    onSubmitResponse(
      toolCallId,
      'El usuario omitió responder a esta pregunta y prefirió no seleccionar ninguna opción.',
    );
  };

  // State when completed
  if (isCompleted) {
    const isSkipped =
      !selectedAnswer ||
      selectedAnswer.includes('omitió responder') ||
      selectedAnswer.includes('no seleccionar ninguna opción');

    return (
      <div className="my-3 max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-lg text-zinc-100 font-sans">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs font-medium text-zinc-400 leading-snug">{question}</div>
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          {isSkipped ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-zinc-800/60 border border-zinc-800 text-zinc-400 text-xs font-medium">
              ✓ Omitido
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
              <Check size={13} className="shrink-0 text-emerald-400" />
              <span>
                Seleccionado: <strong className="text-zinc-200 font-medium">{selectedAnswer}</strong>
              </span>
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="my-3 max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900/90 p-4 shadow-xl text-zinc-100 font-sans transition-all">
      {/* Title / Question & Close Button */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="text-sm sm:text-base font-medium text-zinc-100 leading-snug flex-1">
          {question}
        </div>
        <button
          onClick={handleSkip}
          className="text-zinc-500 hover:text-zinc-300 p-1 rounded-lg transition-colors shrink-0"
          title="Omitir y cerrar"
        >
          <X size={16} />
        </button>
      </div>

      {/* Options List */}
      <div className="space-y-2 mb-3">
        {options.map((opt, idx) => (
          <button
            key={idx}
            onClick={() => handleSelectOption(opt)}
            className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/50 hover:border-zinc-600 transition-all cursor-pointer select-none text-left group"
          >
            <span className="w-5 h-5 rounded bg-zinc-900/80 text-zinc-500 font-mono text-xs flex items-center justify-center shrink-0 border border-zinc-800 group-hover:text-zinc-300 group-hover:border-zinc-700 transition-colors">
              {idx + 1}
            </span>
            <span className="text-zinc-200 text-xs sm:text-sm font-normal flex-1 group-hover:text-zinc-100 transition-colors">
              {opt}
            </span>
          </button>
        ))}

        {/* Custom Input Trigger Button / Input Area */}
        {allowCustom && (
          <div>
            {!showCustomInput ? (
              <button
                onClick={() => setShowCustomInput(true)}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-zinc-800/40 hover:bg-zinc-800/80 border border-dashed border-zinc-700/70 hover:border-zinc-600 transition-all cursor-pointer select-none text-left group"
              >
                <span className="w-5 h-5 rounded bg-zinc-900/80 text-zinc-500 text-xs flex items-center justify-center shrink-0 border border-zinc-800 group-hover:text-zinc-300 transition-colors">
                  <Pencil size={11} />
                </span>
                <span className="text-zinc-400 text-xs sm:text-sm font-normal flex-1 group-hover:text-zinc-200 transition-colors">
                  Algo más...
                </span>
              </button>
            ) : (
              <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
                <input
                  type="text"
                  autoFocus
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCustomSubmit();
                    if (e.key === 'Escape') setShowCustomInput(false);
                  }}
                  placeholder="Escribe tu aclaración personalizada..."
                  className="w-full bg-transparent text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-500 outline-none"
                />
                <div className="flex items-center justify-end gap-2 pt-1 border-t border-zinc-800/80">
                  <button
                    onClick={() => setShowCustomInput(false)}
                    className="px-2.5 py-1 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleCustomSubmit}
                    disabled={!customText.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 text-zinc-900 hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Send size={11} />
                    <span>Enviar</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-end pt-1">
        <button
          onClick={handleSkip}
          className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-800/80 transition-colors"
        >
          Omitir
        </button>
      </div>
    </div>
  );
}
