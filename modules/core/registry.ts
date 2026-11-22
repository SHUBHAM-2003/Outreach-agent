import type { FunctionDeclaration } from '@google/genai';
import { handleOutreachTool } from '../outreach/handlers.ts';
import { OUTREACH_TOOL_DECLARATIONS } from '../outreach/tools.ts';
import { MEMORY_TOOL_DECLARATIONS, handleMemoryTool } from './memory.ts';

export type ToolHandler = (
  toolName: string,
  args: Record<string, unknown>
) => Promise<unknown>;

export interface AgentModule {
  id: string;
  name: string;
  uiTab?: {
    id: string;
    label: string;
  };
  tools: FunctionDeclaration[];
  handleTool: ToolHandler;
}

export const outreachModule: AgentModule = {
  id: 'outreach',
  name: 'Outreach & Mail',
  uiTab: { id: 'leads', label: 'Leads' },
  tools: OUTREACH_TOOL_DECLARATIONS,
  handleTool: handleOutreachTool,
};

const memoryModule: AgentModule = {
  id: 'core_memory',
  name: 'Core Memory',
  tools: MEMORY_TOOL_DECLARATIONS,
  handleTool: handleMemoryTool,
};

// Future agency modules (CRM, invoices, tasks, clients) register here.
export const REGISTERED_MODULES: AgentModule[] = [memoryModule, outreachModule];

export function getAllModuleTools(): FunctionDeclaration[] {
  return REGISTERED_MODULES.flatMap((m) => m.tools);
}

export async function dispatchModuleTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  for (const mod of REGISTERED_MODULES) {
    if (mod.tools.some((t) => t.name === name)) {
      return mod.handleTool(name, args);
    }
  }
  return { error: `Tool "${name}" is not registered in any active module.` };
}
