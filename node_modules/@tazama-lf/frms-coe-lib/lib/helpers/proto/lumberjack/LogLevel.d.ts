export declare const LogLevel: {
    readonly trace: "trace";
    readonly debug: "debug";
    readonly info: "info";
    readonly warn: "warn";
    readonly error: "error";
    readonly fatal: "fatal";
};
export type LogLevel = 'trace' | 0 | 'debug' | 1 | 'info' | 2 | 'warn' | 3 | 'error' | 4 | 'fatal' | 5;
export type LogLevel__Output = (typeof LogLevel)[keyof typeof LogLevel];
