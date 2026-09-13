import type { Account } from "../config.js";
import { logger } from "../log.js";
import { describe, withAgent, type Agent, type AgentOptions } from "../steel/agent.js";

const log = logger("pool");

export interface AgentResult<T> {
  accountId: string;
  value?: T;
  error?: string;
}

/**
 * Runs one job per account, each in its own Steel browser, with a ceiling on
 * how many browsers are alive at once.
 */
export async function runAcrossAgents<T>(
  accounts: Account[],
  options: AgentOptions & { maxConcurrent: number },
  job: (agent: Agent) => Promise<T>,
): Promise<AgentResult<T>[]> {
  const { maxConcurrent, ...agentOptions } = options;
  const results: AgentResult<T>[] = [];
  const queue = [...accounts];

  const worker = async (): Promise<void> => {
    for (let account = queue.shift(); account; account = queue.shift()) {
      try {
        results.push({
          accountId: account.id,
          value: await withAgent(account, agentOptions, job),
        });
      } catch (error) {
        log.error(`[${account.id}] ${describe(error)}`);
        results.push({ accountId: account.id, error: describe(error) });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(maxConcurrent, accounts.length)) }, worker),
  );
  return results;
}
