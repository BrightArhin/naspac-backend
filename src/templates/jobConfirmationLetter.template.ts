import moment from 'moment';

function ordinalDay(day: number) {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  if (day % 10 === 1) return `${day}st`;
  if (day % 10 === 2) return `${day}nd`;
  if (day % 10 === 3) return `${day}rd`;
  return `${day}th`;
}

function formatServiceDate(year: number, monthIndex: number, day: number) {
  const date = moment({ year, month: monthIndex, date: day });
  return `${date.format('dddd')}, ${ordinalDay(day)} ${date.format('MMMM')} ${year}`;
}

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
    departmentName,
    letterheadBase64,
    signatureBase64,
  } = params;

  const startDate = formatServiceDate(currentYear, 10, 2);
  const endDate = formatServiceDate(nextYear, 9, 29);
  const reportInstruction = /regional office/i.test(departmentName)
    ? 'Kindly report to the Regional Administrator, with two copies'
    : 'Kindly report to the undersigned, with two copies';

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
        text: [
          { text: `${submission.fullName.toUpperCase()}`, bold: true },
          '\n',
          { text: 'NATIONAL SERVICE PERSON', bold: true },
          '\n',
          { text: `TEL: ${submission.user.phoneNumber}`, bold: true },
        ],
        fontSize: 11,
        margin: [0, 28, 0, 2],
      },
      {
        text: `Dear ${submission.fullName},`,
        fontSize: 11,
        margin: [0, 16, 0, 10],
      },
      {
        text: `APPOINTMENT - NATIONAL SERVICE, ${yearRange}`,
        bold: true,
        fontSize: 12,
        alignment: 'left',
        decoration: 'underline',
        margin: [0, 10, 0, 20],
      },
      {
        text: [
          'We are pleased to inform you that you have been accepted to undertake your National Service at ',
          { text: departmentName, bold: true },
          ' with effect from ',
          { text: `${startDate} to ${endDate}`, bold: true },
          '.',
        ],
        fontSize: 11,
        margin: [0, 0, 0, 10],
      },
      {
        text: 'During your service year, you will be subject to the rules and regulations of both Ghana Cocoa Board and the National Service Scheme.',
        fontSize: 11,
        margin: [0, 0, 0, 10],
      },
      {
        text: [
          'Ghana Cocoa Board will pay you a monthly National Service Allowance of ',
          { text: 'Seven Hundred and Fifteen Ghana Cedis, Fifty-Seven Pesewas (GH¢715.57). ', bold: true },
          'Please note that you will not be covered by the Board’s Insurance Scheme during this period.',
        ],
        fontSize: 11,
        margin: [0, 0, 0, 10],
      },
      {
        text: `We trust that you will work diligently and conduct yourself professionally during the period for our mutual benefit. ${reportInstruction} of this appointment letter, a copy of your Ghana Card and your Bank Account Details (on a bank statement, cheque leaflet or pay-in-slip).`,
        fontSize: 11,
        margin: [0, 0, 0, 10],
      },
      {
        text: [
          'You will be entitled to ',
          { text: `one (1) month terminal leave in October ${nextYear}`, bold: true },
          '. Should you have any questions or require further clarification, please do not hesitate to reach out on ',
          { text: 'Telephone Number: 0244342058.', bold: true },
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
        margin: [0, 0, 0, 6],
      },
      {
        text: 'Yours sincerely,',
        fontSize: 11,
        margin: [0, 0, 0, 2],
      },
      {
        image: 'signature',
        width: 110,
        alignment: 'left',
        margin: [0, 0, 0, 1],
      },
      { text: 'PAZ OWUSU BOAKYE (MRS.)', bold: true, fontSize: 11, margin: [0, 0, 0, 0] },
      { text: 'DEP. DIRECTOR, HUMAN RESOURCE', bold: true, fontSize: 11, margin: [0, 0, 0, 0] },
      { text: 'FOR: DIRECTOR, HUMAN RESOURCE', bold: true, fontSize: 11, margin: [0, 2, 0, 6] },
      { text: 'cc: Director, Human Resource', bold: true, fontSize: 11, margin: [0, 0, 0, 0] },
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
    pageMargins: [40, 136, 40, 60],
  };
}

export type JobConfirmationLetterTemplateParams = BuildParams;


