"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPacs002FromColumns = exports.getPacs008FromPain001 = exports.getPain013FromPain001 = exports.getPain001FromColumns = exports.Fields = void 0;
const uuid_1 = require("uuid");
var Fields;
(function (Fields) {
    Fields[Fields["PROCESSING_DATE_TIME"] = 0] = "PROCESSING_DATE_TIME";
    Fields[Fields["MESSAGE_ID"] = 1] = "MESSAGE_ID";
    Fields[Fields["TRANSACTION_TYPE"] = 2] = "TRANSACTION_TYPE";
    Fields[Fields["PAYMENT_CURRENCY_CODE"] = 3] = "PAYMENT_CURRENCY_CODE";
    Fields[Fields["TOTAL_PAYMENT_AMOUNT"] = 4] = "TOTAL_PAYMENT_AMOUNT";
    Fields[Fields["SENDER_ID"] = 5] = "SENDER_ID";
    Fields[Fields["SENDER_NAME"] = 6] = "SENDER_NAME";
    Fields[Fields["RECEIVER_ID"] = 7] = "RECEIVER_ID";
    Fields[Fields["RECEIVER_NAME"] = 8] = "RECEIVER_NAME";
    Fields[Fields["SENDER_AGENT_SPID"] = 9] = "SENDER_AGENT_SPID";
    Fields[Fields["RECEIVER_AGENT_SPID"] = 10] = "RECEIVER_AGENT_SPID";
    Fields[Fields["SENDER_ACCOUNT"] = 11] = "SENDER_ACCOUNT";
    Fields[Fields["RECEIVER_ACCOUNT"] = 12] = "RECEIVER_ACCOUNT";
    Fields[Fields["REPORTING_CODE"] = 13] = "REPORTING_CODE";
})(Fields || (exports.Fields = Fields = {}));
function safeDate(isoDateString) {
    const date = new Date(isoDateString);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`Invalid ISO date: ${isoDateString}`);
    }
    return date;
}
function adjustInMilliseconds(isoDateString, milliseconds) {
    const date = safeDate(isoDateString);
    date.setTime(date.getTime() - milliseconds);
    return date.toISOString();
}
function splitName(fullName) {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    return {
        first: parts[0] ?? '',
        last: parts.slice(1).join(' '),
    };
}
const getPain001FromColumns = (columns, tenantId) => {
    const end2endID = columns[Fields.MESSAGE_ID];
    const senderName = splitName(columns[Fields.SENDER_NAME]);
    const receiverName = splitName(columns[Fields.RECEIVER_NAME]);
    const pain001 = {
        CstmrCdtTrfInitn: {
            GrpHdr: {
                MsgId: end2endID,
                CreDtTm: adjustInMilliseconds(columns[Fields.PROCESSING_DATE_TIME], 3000),
                InitgPty: {
                    Nm: columns[Fields.SENDER_NAME],
                    Id: {
                        PrvtId: {
                            DtAndPlcOfBirth: {
                                BirthDt: new Date('1968-02-01'),
                                CityOfBirth: 'Unknown',
                                CtryOfBirth: 'ZZ',
                            },
                            Othr: [
                                {
                                    Id: columns[Fields.SENDER_ID],
                                    SchmeNm: { Prtry: 'ID_NUMBER' },
                                },
                            ],
                        },
                    },
                    CtctDtls: { MobNb: '+00-000000000' },
                },
                NbOfTxs: 1,
            },
            PmtInf: {
                PmtInfId: columns[Fields.MESSAGE_ID],
                PmtMtd: 'TRA',
                ReqdAdvcTp: {
                    DbtAdvc: {
                        Cd: 'ADWD',
                        Prtry: 'Advice with transaction details',
                    },
                },
                ReqdExctnDt: {
                    Dt: safeDate(columns[Fields.PROCESSING_DATE_TIME]),
                    DtTm: safeDate(columns[Fields.PROCESSING_DATE_TIME]),
                },
                Dbtr: {
                    Nm: columns[Fields.SENDER_NAME],
                    CtctDtls: { MobNb: '+00-000000000' },
                    Id: {
                        PrvtId: {
                            DtAndPlcOfBirth: {
                                BirthDt: new Date('1968-02-01'),
                                CityOfBirth: 'Unknown',
                                CtryOfBirth: 'ZZ',
                            },
                            Othr: [
                                {
                                    Id: columns[Fields.SENDER_ID],
                                    SchmeNm: { Prtry: 'ID_NUMBER' },
                                },
                            ],
                        },
                    },
                },
                DbtrAcct: {
                    Id: {
                        Othr: [
                            {
                                Id: columns[Fields.SENDER_ACCOUNT],
                                SchmeNm: { Prtry: 'ACCOUNT_NUMBER' },
                            },
                        ],
                    },
                    Nm: columns[Fields.SENDER_NAME],
                },
                DbtrAgt: {
                    FinInstnId: {
                        ClrSysMmbId: { MmbId: columns[Fields.SENDER_AGENT_SPID] },
                    },
                },
                CdtTrfTxInf: {
                    PmtId: { EndToEndId: end2endID },
                    PmtTpInf: {
                        CtgyPurp: { Prtry: columns[Fields.TRANSACTION_TYPE] },
                    },
                    Amt: {
                        InstdAmt: {
                            Amt: {
                                Amt: Number(columns[Fields.TOTAL_PAYMENT_AMOUNT]),
                                Ccy: columns[Fields.PAYMENT_CURRENCY_CODE],
                            },
                        },
                        EqvtAmt: {
                            Amt: {
                                Amt: Number(columns[Fields.TOTAL_PAYMENT_AMOUNT]),
                                Ccy: columns[Fields.PAYMENT_CURRENCY_CODE],
                            },
                            CcyOfTrf: columns[Fields.PAYMENT_CURRENCY_CODE],
                        },
                    },
                    ChrgBr: 'DEBT',
                    CdtrAgt: {
                        FinInstnId: {
                            ClrSysMmbId: { MmbId: columns[Fields.RECEIVER_AGENT_SPID] },
                        },
                    },
                    Cdtr: {
                        Nm: columns[Fields.RECEIVER_NAME],
                        Id: {
                            PrvtId: {
                                DtAndPlcOfBirth: {
                                    BirthDt: new Date('1968-02-01'),
                                    CityOfBirth: 'Unknown',
                                    CtryOfBirth: 'ZZ',
                                },
                                Othr: [
                                    {
                                        Id: columns[Fields.RECEIVER_ID],
                                        SchmeNm: { Prtry: 'ID_NUMBER' },
                                    },
                                ],
                            },
                        },
                        CtctDtls: { MobNb: '+00-000000001' },
                    },
                    CdtrAcct: {
                        Id: {
                            Othr: [
                                {
                                    Id: columns[Fields.RECEIVER_ACCOUNT],
                                    SchmeNm: { Prtry: 'ACCOUNT_NUMBER' },
                                },
                            ],
                        },
                        Nm: columns[Fields.RECEIVER_NAME],
                    },
                    Purp: { Cd: 'MP2P' },
                    RgltryRptg: {
                        Dtls: {
                            Tp: 'REPORTING CODE',
                            Cd: columns[Fields.REPORTING_CODE],
                        },
                    },
                    RmtInf: { Ustrd: '' },
                    SplmtryData: {
                        Envlp: {
                            Doc: {
                                Dbtr: {
                                    FrstNm: senderName.first,
                                    MddlNm: '',
                                    LastNm: senderName.last,
                                    MrchntClssfctnCd: 'BLANK',
                                },
                                Cdtr: {
                                    FrstNm: receiverName.first,
                                    MddlNm: '',
                                    LastNm: receiverName.last,
                                    MrchntClssfctnCd: 'BLANK',
                                },
                                DbtrFinSvcsPrvdrFees: {
                                    Amt: 0,
                                    Ccy: columns[Fields.PAYMENT_CURRENCY_CODE],
                                },
                                Xprtn: new Date(safeDate(columns[Fields.PROCESSING_DATE_TIME]).getTime() + 5 * 60000),
                            },
                        },
                    },
                },
            },
            SplmtryData: {
                Envlp: {
                    Doc: {
                        InitgPty: {
                            InitrTp: '',
                            Glctn: { Lat: '', Long: '' },
                        },
                    },
                },
            },
        },
        TxTp: 'pain.001.001.11',
        TenantId: tenantId,
    };
    return pain001;
};
exports.getPain001FromColumns = getPain001FromColumns;
const getPain013FromPain001 = (pain001) => {
    const pain013 = {
        TxTp: 'pain.013.001.09',
        TenantId: pain001.TenantId,
        CdtrPmtActvtnReq: {
            GrpHdr: {
                MsgId: (0, uuid_1.v4)().replace(/-/g, ''),
                CreDtTm: adjustInMilliseconds(pain001.CstmrCdtTrfInitn.GrpHdr.CreDtTm, -1000),
                NbOfTxs: 1,
                InitgPty: {
                    Nm: pain001.CstmrCdtTrfInitn.GrpHdr.InitgPty.Nm,
                    Id: {
                        PrvtId: {
                            DtAndPlcOfBirth: {
                                BirthDt: new Date(),
                                CityOfBirth: 'Unknown',
                                CtryOfBirth: 'ZZ',
                            },
                            Othr: [pain001.CstmrCdtTrfInitn.GrpHdr.InitgPty.Id.PrvtId.Othr[0]],
                        },
                    },
                    CtctDtls: { MobNb: '' },
                },
            },
            PmtInf: {
                PmtInfId: pain001.CstmrCdtTrfInitn.PmtInf.PmtInfId,
                PmtMtd: pain001.CstmrCdtTrfInitn.PmtInf.PmtMtd,
                ReqdAdvcTp: {
                    DbtAdvc: {
                        Cd: pain001.CstmrCdtTrfInitn.PmtInf.ReqdAdvcTp.DbtAdvc.Cd,
                        Prtry: pain001.CstmrCdtTrfInitn.PmtInf.ReqdAdvcTp.DbtAdvc.Prtry,
                    },
                },
                ReqdExctnDt: {
                    DtTm: pain001.CstmrCdtTrfInitn.PmtInf.ReqdExctnDt.DtTm,
                },
                XpryDt: {
                    DtTm: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.SplmtryData.Envlp.Doc.Xprtn,
                },
                Dbtr: {
                    Nm: pain001.CstmrCdtTrfInitn.PmtInf.Dbtr.Nm,
                    CtctDtls: pain001.CstmrCdtTrfInitn.PmtInf.Dbtr.CtctDtls,
                    Id: {
                        PrvtId: {
                            DtAndPlcOfBirth: {
                                BirthDt: new Date(),
                                CityOfBirth: 'Unknown',
                                CtryOfBirth: 'ZZ',
                            },
                            Othr: [pain001.CstmrCdtTrfInitn.GrpHdr.InitgPty.Id.PrvtId.Othr[0]],
                        },
                    },
                },
                DbtrAcct: {
                    Nm: pain001.CstmrCdtTrfInitn.PmtInf.DbtrAcct.Nm,
                    Id: {
                        Othr: [
                            {
                                Id: pain001.CstmrCdtTrfInitn.PmtInf.DbtrAcct.Id.Othr[0].Id,
                                SchmeNm: {
                                    Prtry: pain001.CstmrCdtTrfInitn.PmtInf.DbtrAcct.Id.Othr[0].SchmeNm.Prtry,
                                },
                                Nm: pain001.CstmrCdtTrfInitn.PmtInf.DbtrAcct.Nm,
                            },
                        ],
                    },
                },
                DbtrAgt: {
                    FinInstnId: {
                        ClrSysMmbId: {
                            MmbId: pain001.CstmrCdtTrfInitn.PmtInf.DbtrAgt.FinInstnId.ClrSysMmbId.MmbId,
                        },
                    },
                },
                CdtTrfTxInf: {
                    PmtId: {
                        EndToEndId: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.PmtId.EndToEndId,
                    },
                    PmtTpInf: {
                        CtgyPurp: {
                            Prtry: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.PmtTpInf.CtgyPurp.Prtry,
                        },
                    },
                    Amt: {
                        InstdAmt: {
                            Amt: {
                                Amt: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Amt.InstdAmt.Amt.Amt,
                                Ccy: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Amt.InstdAmt.Amt.Ccy,
                            },
                        },
                        EqvtAmt: {
                            Amt: {
                                Amt: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Amt.EqvtAmt.Amt.Amt,
                                Ccy: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Amt.EqvtAmt.Amt.Ccy,
                            },
                            CcyOfTrf: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Amt.EqvtAmt.CcyOfTrf,
                        },
                    },
                    ChrgBr: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.ChrgBr,
                    CdtrAgt: {
                        FinInstnId: {
                            ClrSysMmbId: {
                                MmbId: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.CdtrAgt.FinInstnId.ClrSysMmbId.MmbId,
                            },
                        },
                    },
                    Cdtr: {
                        Nm: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Cdtr.Nm,
                        CtctDtls: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Cdtr.CtctDtls,
                        Id: {
                            PrvtId: {
                                DtAndPlcOfBirth: {
                                    BirthDt: new Date(),
                                    CityOfBirth: 'Unknown',
                                    CtryOfBirth: 'ZZ',
                                },
                                Othr: [
                                    pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Cdtr.Id.PrvtId.Othr[0],
                                ],
                            },
                        },
                    },
                    CdtrAcct: {
                        Id: {
                            Othr: [
                                {
                                    Id: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.CdtrAcct.Id.Othr[0].Id,
                                    SchmeNm: {
                                        Prtry: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.CdtrAcct.Id.Othr[0].SchmeNm.Prtry,
                                    },
                                },
                            ],
                        },
                        Nm: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.CdtrAcct.Nm,
                    },
                    Purp: { Cd: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Purp.Cd },
                    RgltryRptg: {
                        Dtls: {
                            Tp: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.RgltryRptg.Dtls.Tp,
                            Cd: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.RgltryRptg.Dtls.Cd,
                        },
                    },
                    RmtInf: { Ustrd: '' },
                    SplmtryData: {
                        Envlp: {
                            Doc: {
                                PyeeRcvAmt: { Amt: { Amt: 0, Ccy: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Amt.InstdAmt.Amt.Ccy } },
                                PyeeFinSvcsPrvdrFee: { Amt: { Amt: 0, Ccy: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Amt.InstdAmt.Amt.Ccy } },
                                PyeeFinSvcsPrvdrComssn: { Amt: { Amt: 0, Ccy: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Amt.InstdAmt.Amt.Ccy } },
                            },
                        },
                    },
                },
            },
            SplmtryData: {
                Envlp: {
                    Doc: {
                        InitgPty: { Glctn: { Lat: '', Long: '' } },
                    },
                },
            },
        },
    };
    return pain013;
};
exports.getPain013FromPain001 = getPain013FromPain001;
const getPacs008FromPain001 = (pain001) => {
    const pacs008 = {
        TxTp: 'pacs.008.001.10',
        TenantId: pain001.TenantId,
        FIToFICstmrCdtTrf: {
            GrpHdr: {
                MsgId: (0, uuid_1.v4)().replace(/-/g, ''),
                CreDtTm: adjustInMilliseconds(pain001.CstmrCdtTrfInitn.GrpHdr.CreDtTm, -1000),
                NbOfTxs: pain001.CstmrCdtTrfInitn.GrpHdr.NbOfTxs,
                SttlmInf: { SttlmMtd: 'CLRG' },
            },
            CdtTrfTxInf: {
                PmtId: {
                    InstrId: pain001.CstmrCdtTrfInitn.PmtInf.PmtInfId,
                    EndToEndId: pain001.CstmrCdtTrfInitn.GrpHdr.MsgId,
                },
                IntrBkSttlmAmt: {
                    Amt: {
                        Amt: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Amt.InstdAmt.Amt.Amt,
                        Ccy: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Amt.InstdAmt.Amt.Ccy,
                    },
                },
                InstdAmt: {
                    Amt: {
                        Amt: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Amt.InstdAmt.Amt.Amt,
                        Ccy: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Amt.InstdAmt.Amt.Ccy,
                    },
                },
                ChrgBr: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.ChrgBr,
                ChrgsInf: {
                    Amt: {
                        Amt: 0,
                        Ccy: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Amt.InstdAmt.Amt.Ccy,
                    },
                    Agt: {
                        FinInstnId: {
                            ClrSysMmbId: {
                                MmbId: pain001.CstmrCdtTrfInitn.PmtInf.DbtrAgt.FinInstnId.ClrSysMmbId.MmbId,
                            },
                        },
                    },
                },
                InitgPty: {
                    Nm: pain001.CstmrCdtTrfInitn.GrpHdr.InitgPty.Nm,
                    Id: pain001.CstmrCdtTrfInitn.GrpHdr.InitgPty.Id,
                    CtctDtls: pain001.CstmrCdtTrfInitn.GrpHdr.InitgPty.CtctDtls,
                },
                Dbtr: {
                    Nm: pain001.CstmrCdtTrfInitn.PmtInf.Dbtr.Nm,
                    Id: pain001.CstmrCdtTrfInitn.PmtInf.Dbtr.Id,
                    CtctDtls: pain001.CstmrCdtTrfInitn.PmtInf.Dbtr.CtctDtls,
                },
                DbtrAcct: {
                    Id: {
                        Othr: [
                            {
                                Id: pain001.CstmrCdtTrfInitn.PmtInf.DbtrAcct.Id.Othr[0].Id,
                                SchmeNm: {
                                    Prtry: pain001.CstmrCdtTrfInitn.PmtInf.DbtrAcct.Id.Othr[0].SchmeNm.Prtry,
                                },
                            },
                        ],
                    },
                    Nm: pain001.CstmrCdtTrfInitn.PmtInf.DbtrAcct.Nm,
                },
                DbtrAgt: {
                    FinInstnId: {
                        ClrSysMmbId: {
                            MmbId: pain001.CstmrCdtTrfInitn.PmtInf.DbtrAgt.FinInstnId.ClrSysMmbId.MmbId,
                        },
                    },
                },
                CdtrAgt: {
                    FinInstnId: {
                        ClrSysMmbId: {
                            MmbId: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.CdtrAgt.FinInstnId.ClrSysMmbId.MmbId,
                        },
                    },
                },
                Cdtr: {
                    Nm: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Cdtr.Nm,
                    Id: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Cdtr.Id,
                    CtctDtls: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Cdtr.CtctDtls,
                },
                CdtrAcct: {
                    Id: {
                        Othr: [
                            {
                                Id: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.CdtrAcct.Id.Othr[0].Id,
                                SchmeNm: {
                                    Prtry: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.CdtrAcct.Id.Othr[0].SchmeNm.Prtry,
                                },
                            },
                        ],
                    },
                    Nm: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.CdtrAcct.Nm,
                },
                Purp: { Cd: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Purp.Cd },
            },
            RgltryRptg: {
                Dtls: {
                    Tp: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.RgltryRptg.Dtls.Tp,
                    Cd: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.RgltryRptg.Dtls.Cd,
                },
            },
            RmtInf: { Ustrd: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.RmtInf.Ustrd },
            SplmtryData: {
                Envlp: {
                    Doc: {
                        Xprtn: pain001.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.SplmtryData.Envlp.Doc.Xprtn,
                        InitgPty: { Glctn: { Lat: '', Long: '' } },
                    },
                },
            },
        },
    };
    return pacs008;
};
exports.getPacs008FromPain001 = getPacs008FromPain001;
const getPacs002FromColumns = (columns) => {
    const pacs002 = {
        TxTp: 'pacs.002.001.12',
        FIToFIPmtSts: {
            GrpHdr: {
                MsgId: (0, uuid_1.v4)().replace(/-/g, ''),
                CreDtTm: columns[Fields.PROCESSING_DATE_TIME],
            },
            TxInfAndSts: {
                OrgnlInstrId: columns[Fields.MESSAGE_ID],
                OrgnlEndToEndId: columns[Fields.MESSAGE_ID],
                TxSts: 'ACCC',
                ChrgsInf: [
                    {
                        Amt: { Amt: 0, Ccy: columns[Fields.PAYMENT_CURRENCY_CODE] },
                        Agt: {
                            FinInstnId: {
                                ClrSysMmbId: { MmbId: columns[Fields.SENDER_AGENT_SPID] },
                            },
                        },
                    },
                    {
                        Amt: { Amt: 0, Ccy: columns[Fields.PAYMENT_CURRENCY_CODE] },
                        Agt: {
                            FinInstnId: {
                                ClrSysMmbId: { MmbId: columns[Fields.SENDER_AGENT_SPID] },
                            },
                        },
                    },
                    {
                        Amt: { Amt: 0, Ccy: columns[Fields.PAYMENT_CURRENCY_CODE] },
                        Agt: {
                            FinInstnId: {
                                ClrSysMmbId: { MmbId: columns[Fields.RECEIVER_AGENT_SPID] },
                            },
                        },
                    },
                ],
                AccptncDtTm: safeDate(columns[Fields.PROCESSING_DATE_TIME]),
                InstgAgt: {
                    FinInstnId: {
                        ClrSysMmbId: { MmbId: columns[Fields.SENDER_AGENT_SPID] },
                    },
                },
                InstdAgt: {
                    FinInstnId: {
                        ClrSysMmbId: { MmbId: columns[Fields.RECEIVER_AGENT_SPID] },
                    },
                },
            },
        },
    };
    return pacs002;
};
exports.getPacs002FromColumns = getPacs002FromColumns;
//# sourceMappingURL=message-generation.js.map