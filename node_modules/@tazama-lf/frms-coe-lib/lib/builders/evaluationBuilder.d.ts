import { type DBConfig, type EvaluationDB } from '../services/dbManager';
export declare function evaluationBuilder(manager: EvaluationDB, evaluationConfig: DBConfig): Promise<void>;
