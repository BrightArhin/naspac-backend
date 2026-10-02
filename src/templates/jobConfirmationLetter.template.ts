import moment from 'moment';

type BuildParams = {
  submission: {
    fullName: string;
    nssNumber: string;
    divisionPostedTo: string;
    user: { phoneNumber: string; department: { name: string } };
  };
  currentYear: number;
  nextYear: number;
  yearRange: string;
  today: string;
  departmentName: string;
  referenceNumber: string;
  letterheadBase64: string | null;
  signatureBase64: string;
};

export function buildJobConfirmationLetterDocDefinition(params: BuildParams) {
  const {
    submission,
    currentYear,
    nextYear,
    yearRange,
    today,
    departmentName,
    referenceNumber,
    letterheadBase64,
    signatureBase64,
  } = params;

  return {
    background: [
      letterheadBase64
        ? {
            image: 'letterhead',
            width: 595,
            absolutePosition: { x: 0, y: 0 },
          }
        : undefined,
    ].filter(Boolean),
    content: [
      { text: '', bold: true, fontSize: 14, alignment: 'center', margin: [0, 0, 0, 20] },
      { text: '', alignment: 'right', fontSize: 11, margin: [0, 0, 0, 5] },
      { text: '', alignment: 'right', fontSize: 11, margin: [0, 0, 0, 20] },
      { text: '', fontSize: 11, margin: [0, 0, 0, 20] },
      {
        columns: [
          {
            text: referenceNumber,
            alignment: 'left',
            fontSize: 11,
            bold: true,
            margin: [120, 0, 0, 10],
          },
          { text: today, alignment: 'right', fontSize: 11, margin: [0, 0, 0, 10] },
        ],
      },
      {
        text: [
          { text: `${submission.fullName.toUpperCase()}`, bold: true },
          '\n',
          { text: `NATIONAL SERVICE PERSON`, bold: true },
          '\n\n',
          { text: `TEL: ${submission.user.phoneNumber}`, bold: true },
        ],
        fontSize: 11,
        margin: [0, 20, 0, 5],
      },
       {
        text: [
        { text: `Dear ${submission.fullName},` },
        ],
        fontSize: 11,
        margin: [0, 0, 0, 10],
      },
      {
        text: `APPOINTMENT – NATIONAL SERVICE ${yearRange}`,
        bold: true,
        fontSize: 12,
        alignment: 'left',
        decoration: 'underline',
        margin: [0, 10, 0, 20],
      },
      {
        text: [
          'We are pleased to inform you that you have been accepted to undertake your National Service at the ',
          { text: `${departmentName}`, bold: true },
          ' with effect from ',
          { text: `Monday, December 1, ${currentYear} to Monday, November 30, ${nextYear}`, bold: true },
          '.',
        ],
        fontSize: 11,
        margin: [0, 0, 0, 10],
      },
      {
        text: [
          'During your service year, you will be subject to the rules and regulations of both Ghana Cocoa Board and the National Service Scheme. ',
        ],
        fontSize: 11,
        margin: [0, 0, 0, 10],
      },
      {
        text: [
          'Ghana Cocoa Board will pay you a monthly National Service Allowance of ',
          { text: 'Seven Hundred and Fifteen Ghana Cedis, Fifty-Seven Pesewas (GHc 715.57). ', bold: true },
          ' Please note that you will not be covered by the Board’s Insurance Scheme during this period.',
        ],
        fontSize: 11,
        margin: [0, 0, 0, 10],
      },
      {
        text: 'We trust that you will work diligently and conduct yourself professionaly during the period for our mutual benefit. Kindly report to the Administrator with two copies of this appointment letter, a copy of your Ghana Card and your Bank Account Details (on a bank statement, cheque leaflet or pay-in-slip).',
        fontSize: 11,
        margin: [0, 0, 0, 10],
      },
      {
        text: [
          'You will be entitled to one (1) month terminal leave in ',
          { text: `November ${nextYear}`, bold: true },
          '. Should you have any questions or require further clarification, please do not hesitate to reach out on Telephone Number: 0244342058' ,
        ],
        fontSize: 11,
        margin: [0, 0, 0, 10],
      },
      {
        text: 'Welcome to the COCOBOD family, and we wish you a successful and rewarding experience with us.',
        fontSize: 11,
        margin: [0, 0, 0, 10],
      },
      {
        text: 'Congratulations!',
        fontSize: 11,
        margin: [0, 0, 0, 10],
      },
      {
        text: 'Yours sincerely,',
        fontSize: 11,
        margin: [0, 0, 0, 10],
      },
      {
        image: 'signature',
        width: 120,
        alignment: 'left',
        margin: [0, 0, 0, 5],
      },
      { text: 'PAZ OWUSU BOAKYE (MRS.)', bold: true, fontSize: 11, margin: [0, 0, 0, 5] },
      { text: 'DEPUTY DIRECTOR, HUMAN RESOURCE', fontSize: 11, margin: [0, 0, 0, 10] },
      { text: [
      'FOR: DIRECTOR, HUMAN RESOURCE\n',
      'cc: Director, Human Resource\n',
      'Ag. Director, Finance\n',
    ],
    fontSize: 11,
    margin: [0, 0, 0, 0],
  },
    ],
    images: {
      ...(letterheadBase64 ? { letterhead: `data:image/png;base64,${letterheadBase64}` } : {}),
      signature: signatureBase64.startsWith('data:')
        ? signatureBase64
        : `data:image/png;base64,${signatureBase64}`,
    },
    defaultStyle: {
      font: 'Roboto',
      fontSize: 11,
    },
    pageMargins: [40, 100, 40, 60],
  };
}

export type JobConfirmationLetterTemplateParams = BuildParams;


