import type { Pacs002, Pacs008, Pain001, Pain013 } from '@tazama-lf/frms-coe-lib/lib/interfaces';
export declare enum Fields {
    PROCESSING_DATE_TIME = 0,
    MESSAGE_ID = 1,
    TRANSACTION_TYPE = 2,
    PAYMENT_CURRENCY_CODE = 3,
    TOTAL_PAYMENT_AMOUNT = 4,
    SENDER_ID = 5,
    SENDER_NAME = 6,
    RECEIVER_ID = 7,
    RECEIVER_NAME = 8,
    SENDER_AGENT_SPID = 9,
    RECEIVER_AGENT_SPID = 10,
    SENDER_ACCOUNT = 11,
    RECEIVER_ACCOUNT = 12,
    REPORTING_CODE = 13
}
export declare const getPain001FromColumns: (columns: string[], tenantId: string) => Pain001;
export declare const getPain013FromPain001: (pain001: Pain001) => Pain013;
export declare const getPacs008FromPain001: (pain001: Pain001) => Pacs008;
export declare const getPacs002FromColumns: (columns: string[]) => Omit<Pacs002, "TenantId">;
