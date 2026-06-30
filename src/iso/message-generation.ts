// SPDX-License-Identifier: Apache-2.0
// Adapted from batch-ppa/src/services/message.generation.service.ts

import type { Pacs002, Pacs008, Pain001, Pain013 } from '@tazama-lf/frms-coe-lib/lib/interfaces';
import { v4 as uuidv4 } from 'uuid';

export enum Fields {
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
  REPORTING_CODE = 13,
}

function safeDate(isoDateString: string): Date {
  const date = new Date(isoDateString);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date: ${isoDateString}`);
  }
  return date;
}

function adjustInMilliseconds(isoDateString: string, milliseconds: number): string {
  const date = safeDate(isoDateString);
  date.setTime(date.getTime() - milliseconds);
  return date.toISOString();
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] ?? '',
    last: parts.slice(1).join(' '),
  };
}

export const getPain001FromColumns = (columns: string[], tenantId: string): Pain001 => {
  const end2endID = columns[Fields.MESSAGE_ID];
  const senderName = splitName(columns[Fields.SENDER_NAME]);
  const receiverName = splitName(columns[Fields.RECEIVER_NAME]);

  const pain001: Pain001 = {
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

export const getPain013FromPain001 = (pain001: Pain001): Pain013 => {
  const pain013: Pain013 = {
    TxTp: 'pain.013.001.09',
    TenantId: pain001.TenantId,
    CdtrPmtActvtnReq: {
      GrpHdr: {
        MsgId: uuidv4().replace(/-/g, ''),
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

export const getPacs008FromPain001 = (pain001: Pain001): Pacs008 => {
  const pacs008: Pacs008 = {
    TxTp: 'pacs.008.001.10',
    TenantId: pain001.TenantId,
    FIToFICstmrCdtTrf: {
      GrpHdr: {
        MsgId: uuidv4().replace(/-/g, ''),
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

export const getPacs002FromColumns = (columns: string[]): Omit<Pacs002, 'TenantId'> => {
  const pacs002: Omit<Pacs002, 'TenantId'> = {
    TxTp: 'pacs.002.001.12',
    FIToFIPmtSts: {
      GrpHdr: {
        MsgId: uuidv4().replace(/-/g, ''),
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
