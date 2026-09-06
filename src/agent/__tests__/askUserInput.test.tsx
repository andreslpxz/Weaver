import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ADVANCED_TOOLS, buildAdvancedToolsList } from '../../lib/tools';
import { InteractivePromptWidget } from '../../components/chat/InteractivePromptWidget';

describe('ask_user_input tool schema and widget', () => {
  it('registers ask_user_input tool correctly in ADVANCED_TOOLS and buildAdvancedToolsList', () => {
    const askTool = ADVANCED_TOOLS.find((t) => t.name === 'ask_user_input');
    expect(askTool).toBeDefined();
    expect(askTool?.description).toContain('widget interactivo');
    expect(askTool?.parameters).toHaveProperty('question');
    expect(askTool?.parameters).toHaveProperty('options');
    expect(askTool?.parameters).toHaveProperty('allow_custom');

    const builtinList = buildAdvancedToolsList();
    const formattedTool = builtinList.find((t) => t.function.name === 'ask_user_input');
    expect(formattedTool).toBeDefined();
    expect(formattedTool?.function.parameters.required).toEqual(['question', 'options']);
  });

  it('renders InteractivePromptWidget correctly with options and allow_custom', () => {
    const handleSubmit = vi.fn();
    render(
      <InteractivePromptWidget
        toolCallId="call-123"
        args={{
          question: '¿Qué framework prefieres?',
          options: ['React', 'Vue', 'Svelte'],
          allow_custom: true,
        }}
        isCompleted={false}
        selectedAnswer={null}
        onSubmitResponse={handleSubmit}
      />
    );

    expect(screen.getByText('¿Qué framework prefieres?')).toBeTruthy();
    expect(screen.getByText('React')).toBeTruthy();
    expect(screen.getByText('Vue')).toBeTruthy();
    expect(screen.getByText('Svelte')).toBeTruthy();

    // Click on option Vue
    fireEvent.click(screen.getByText('Vue'));
    expect(handleSubmit).toHaveBeenCalledWith('call-123', 'Vue');
  });

  it('handles custom input mode in InteractivePromptWidget when allow_custom is true', () => {
    const handleSubmit = vi.fn();
    render(
      <InteractivePromptWidget
        toolCallId="call-456"
        args={{
          question: 'Selecciona una base de datos',
          options: ['PostgreSQL', 'MongoDB'],
          allow_custom: true,
        }}
        isCompleted={false}
        selectedAnswer={null}
        onSubmitResponse={handleSubmit}
      />
    );

    // Click "Algo más..." button first to reveal custom input field
    const customToggleBtn = screen.getByText('Algo más...');
    fireEvent.click(customToggleBtn);

    const input = screen.getByPlaceholderText('Escribe tu aclaración personalizada...');
    fireEvent.change(input, { target: { value: 'SQLite' } });

    const sendBtn = screen.getByText('Enviar');
    fireEvent.click(sendBtn);

    expect(handleSubmit).toHaveBeenCalledWith('call-456', 'SQLite');
  });

  it('renders completed state when isCompleted is true', () => {
    render(
      <InteractivePromptWidget
        toolCallId="call-789"
        args={{
          question: '¿Continuar con la instalación?',
          options: ['Sí', 'No'],
        }}
        isCompleted={true}
        selectedAnswer="Sí"
        onSubmitResponse={vi.fn()}
      />
    );

    expect(screen.getByText('Seleccionado:')).toBeTruthy();
    expect(screen.getByText('Sí')).toBeTruthy();
  });
});
