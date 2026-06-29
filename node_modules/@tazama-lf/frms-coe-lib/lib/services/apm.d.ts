import apm, { type AgentConfigOptions, type TransactionOptions } from 'elastic-apm-node';
export declare class Apm {
    #private;
    constructor(apmConfig?: AgentConfigOptions);
    startTransaction: (name: string, options?: TransactionOptions) => apm.Transaction | null;
    startSpan: (name: string) => apm.Span | null;
    getCurrentTraceparent: () => string | null;
}
