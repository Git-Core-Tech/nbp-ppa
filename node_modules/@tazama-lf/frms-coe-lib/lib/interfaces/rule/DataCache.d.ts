export interface DataCache {
    dbtrId?: string;
    cdtrId?: string;
    dbtrAcctId?: string;
    cdtrAcctId?: string;
    evtId?: string;
    creDtTm?: string;
    instdAmt?: {
        amt: number;
        ccy: string;
    };
    intrBkSttlmAmt?: {
        amt: number;
        ccy: string;
    };
    xchgRate?: number;
}
