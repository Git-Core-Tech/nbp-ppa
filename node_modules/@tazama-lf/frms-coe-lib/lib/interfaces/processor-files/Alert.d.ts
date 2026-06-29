import type { TADPResult } from './TADPResult';
import type { MetaData } from '../metaData';
export interface Alert {
    evaluationID: string;
    metaData?: MetaData;
    status: 'ALRT' | 'NALT';
    timestamp: string;
    tadpResult: TADPResult;
}
