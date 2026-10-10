/**
 * The real September 2026 enquiry log, transcribed from
 * data/september-2026-enquiries.txt (anonymised at source by the studio).
 *
 * This is the "before" month: no voice agent, a front desk covering 10am-7pm,
 * and WhatsApp monitored only during those hours. Its failures are real and
 * they are the argument for the whole system - a missed call at 10:47pm that
 * was never recovered, an enquiry that sat two days before anyone replied, a
 * WhatsApp thread that went four days and lost the lead's trust, and one that
 * arrived on a Saturday evening and was gone by Monday.
 *
 * `response_sec` is how long the enquirer actually waited for a first human
 * response. For phone calls answered live that is seconds. For WhatsApp it is
 * the gap between their message and the first reply, which the log records
 * exactly. For web forms the log does not say, so those carry the studio's
 * own stated figure instead - about half went past 48 hours - and are marked
 * `estimated: true` so nobody mistakes them for measured data.
 */

export const SEPTEMBER_2026 = [
  /* ---------------- phone: front desk, 10am-7pm ---------------- */
  { ref: 'T01', channel: 'phone', at: '2026-09-02T10:23', duration: 252, response_sec: 4,
    name: 'Priya Raghunathan', locality: 'Kothrud', property: '3BHK', sqft: 1400,
    scope: 'Full home redesign - kitchen, living room, both bedrooms', state: 'lived_in',
    timeline: '6 months', decider: 'caller_and_partner', source: 'referral',
    referrer: 'Shruti Joshi', budget: null, result: 'qualified', booked: true, price_asks: 0 },

  { ref: 'T02', channel: 'phone', at: '2026-09-03T14:41', duration: 308, response_sec: 3,
    name: 'Anjali Bhave', locality: 'Wakad', property: '2BHK', sqft: 950,
    scope: 'Full redesign - modular kitchen, wardrobes, living room, both bedrooms',
    state: 'builder_handover', timeline: '2 months', decider: 'caller', source: 'instagram',
    budget: null, result: 'qualified', booked: true, price_asks: 2, push_outcome: 'booked' },

  { ref: 'T03', channel: 'phone', at: '2026-09-03T16:15', duration: 160, response_sec: 5,
    name: 'Suresh Patil', locality: 'Nashik', property: 'home office and study', sqft: null,
    scope: 'Redo home office and study', state: 'lived_in', timeline: '3 months',
    decider: 'caller', source: 'linkedin', budget: null, result: 'declined',
    decline: 'outside service area', criteria_failed: ['service_area'], booked: false, price_asks: 0 },

  { ref: 'T04', channel: 'phone', at: '2026-09-04T11:07', duration: 202, response_sec: 6,
    name: null, locality: 'Pune', property: 'living room', sqft: null,
    scope: 'Just want suggestions on colours and furniture arrangement - no execution',
    state: 'lived_in', timeline: 'flexible', decider: 'caller', source: 'other',
    budget: null, result: 'declined', decline: 'advice only, no execution',
    criteria_failed: ['real_project'], booked: false, price_asks: 0 },

  { ref: 'T05', channel: 'phone', at: '2026-09-05T10:52', duration: 404, response_sec: 3,
    name: 'Aarti Mehta', locality: 'Koregaon Park', property: '4BHK', sqft: 2400,
    scope: 'Complete redesign - new flooring, kitchen, all four bedrooms',
    state: 'bare_shell', timeline: '4 months', decider: 'caller_and_partner',
    source: 'referral', referrer: 'Vikram Agarwal', budget: null, result: 'qualified',
    booked: true, consultation_type: 'site visit', price_asks: 0 },

  { ref: 'T06', channel: 'phone', at: '2026-09-05T15:28', duration: 301, response_sec: 4,
    name: 'Karan Vaidya', locality: 'Baner', property: 'office', sqft: 800,
    scope: 'Full fitout - workstations for 20, a cabin, a meeting room, a break area',
    state: 'bare_shell', timeline: '3 months', decider: 'caller', source: 'other',
    budget: null, result: 'qualified', booked: true, price_asks: 0 },

  { ref: 'T07', channel: 'phone', at: '2026-09-08T09:44', duration: 195, response_sec: 7,
    name: null, locality: 'Kothrud', property: 'living room and kitchen', sqft: null,
    scope: 'Living room and kitchen before Diwali', state: 'lived_in',
    timeline: '3 weeks', decider: 'caller', source: 'other', budget: null,
    result: 'declined', decline: 'timeline too tight', criteria_failed: ['timeline'],
    booked: false, price_asks: 0 },

  // The one the system exists for. Rang at 10:47pm, nobody there, never recovered.
  { ref: 'T08', channel: 'phone', at: '2026-09-09T22:47', duration: 0, response_sec: null,
    name: null, locality: 'Nanded City', property: null, sqft: null, scope: null,
    state: 'unknown', timeline: null, decider: 'unknown', source: 'other', budget: null,
    result: 'incomplete', booked: false, price_asks: 0, missed: true,
    note: 'Missed call, no voicemail. Call-back next morning went unanswered.' },

  { ref: 'T09', channel: 'phone', at: '2026-09-10T11:32', duration: 352, response_sec: 4,
    name: 'Sheetal Deshpande', locality: 'Viman Nagar', property: '2BHK', sqft: null,
    scope: 'Existing project - designer unresponsive for five days', state: 'under_renovation',
    timeline: null, decider: 'caller', source: 'other', budget: null, result: 'escalated',
    escalation: 'Existing client complaint - designer unresponsive, asked for Nikhil by name',
    booked: false, price_asks: 0 },

  { ref: 'T10', channel: 'phone', at: '2026-09-11T14:04', duration: 220, response_sec: 5,
    name: null, locality: 'Kharadi', property: '1BHK', sqft: 550,
    scope: 'Kitchen and one bedroom', state: 'lived_in', timeline: '4 months',
    decider: 'caller', source: 'other', budget: '1 to 1.5 lakh maximum',
    result: 'declined', decline: 'budget well below our minimum',
    criteria_failed: ['budget'], booked: false, price_asks: 1 },

  { ref: 'T11', channel: 'phone', at: '2026-09-12T10:18', duration: 382, response_sec: 3,
    name: 'Rakesh Menon', locality: 'Baner', property: '2BHK', sqft: null,
    scope: 'Living room, bedroom and kitchen - no structural changes, design and fittings',
    state: 'lived_in', timeline: '4 months', decider: 'caller', source: 'other',
    budget: null, result: 'qualified', booked: true, price_asks: 0 },

  { ref: 'T12', channel: 'phone', at: '2026-09-15T10:05', duration: 450, response_sec: 4,
    name: 'Anand Sharma', locality: 'Kalyani Nagar', property: 'villa, ground plus two floors',
    sqft: 5500, scope: 'Full end-to-end design, new construction', state: 'bare_shell',
    timeline: '6 months', decider: 'caller', source: 'other', budget: null,
    result: 'qualified', booked: true, consultation_type: 'site visit', price_asks: 0 },

  { ref: 'T13', channel: 'phone', at: '2026-09-16T12:19', duration: 368, response_sec: 6,
    name: 'Mihir Ranade', locality: 'Aundh', property: '3BHK', sqft: 1100,
    scope: 'Kitchen, wardrobes in both bedrooms, living room', state: 'lived_in',
    timeline: '4 months', decider: 'caller', source: 'other', budget: null,
    result: 'qualified', booked: true, price_asks: 2, push_outcome: 'booked' },

  { ref: 'T14', channel: 'phone', at: '2026-09-17T11:41', duration: 295, response_sec: 4,
    name: 'Sachin Kale', locality: 'Hadapsar', property: '3BHK', sqft: null,
    scope: 'Proper design for parents, new possession', state: 'builder_handover',
    timeline: '4 months', decider: 'researching_for_others', source: 'other', budget: null,
    result: 'qualified', booked: true, price_asks: 0,
    note: 'Caller is the son. Owners are the parents; both will attend the consultation.' },

  { ref: 'T15', channel: 'phone', at: '2026-09-18T15:12', duration: 344, response_sec: 3,
    name: 'Smita Barve', locality: 'Undri', property: '2BHK', sqft: 875,
    scope: 'Full home - kitchen, wardrobes, living room', state: 'builder_handover',
    timeline: '6 weeks', decider: 'caller_and_partner', source: 'other', budget: null,
    result: 'qualified', booked: true, price_asks: 0 },

  // Called on Monday, heard nothing, called back on Friday. Two days of silence,
  // and the caller says so: "This is not a good sign if you forget before you
  // even start."
  { ref: 'T16', channel: 'phone', at: '2026-09-15T14:30', duration: 318, response_sec: 331200,
    name: 'Girish Nair', locality: 'Viman Nagar', property: '3BHK', sqft: null,
    scope: 'Full home interiors', state: 'lived_in', timeline: '4 months',
    decider: 'caller', source: 'other', budget: null, result: 'qualified',
    booked: true, price_asks: 0, estimated: false,
    note: 'Enquiry received Monday, no follow-up, re-logged Friday. Caller frustrated.' },

  { ref: 'T17', channel: 'phone', at: '2026-09-22T14:14', duration: 342, response_sec: 120,
    name: 'Ritu Kapoor', locality: 'Pimple Saudagar', property: '3BHK', sqft: 1050,
    scope: 'Kitchen, wardrobes, living room', state: 'lived_in', timeline: '6 months',
    decider: 'caller_and_partner', source: 'other', budget: null, result: 'qualified',
    booked: true, price_asks: 0, note: 'First call dropped at 1 min 12 sec; caller rang back.' },

  { ref: 'T18', channel: 'phone', at: '2026-09-23T11:55', duration: 182, response_sec: 5,
    name: null, locality: 'Kothrud', property: 'coworking pod', sqft: 180,
    scope: 'Make the pod look nice - lighting, a desk, storage', state: 'lived_in',
    timeline: '2 months', decider: 'caller', source: 'other', budget: null,
    result: 'declined', decline: 'scope too small', criteria_failed: ['real_project'],
    booked: false, price_asks: 1 },

  { ref: 'T19', channel: 'phone', at: '2026-09-24T16:02', duration: 170, response_sec: 4,
    name: null, locality: 'Koregaon Park', property: 'restaurant', sqft: null,
    scope: 'Restaurant interiors', state: 'bare_shell', timeline: '4 months',
    decider: 'caller', source: 'instagram', budget: null, result: 'declined',
    decline: 'hospitality is out of scope', criteria_failed: ['real_project'],
    booked: false, price_asks: 0 },

  { ref: 'T20', channel: 'phone', at: '2026-09-25T09:15', duration: 284, response_sec: 4,
    name: 'Pooja Lunawat', locality: 'Magarpatta', property: '2BHK', sqft: 900,
    scope: 'Kitchen, both bedrooms, living room', state: 'lived_in',
    timeline: '4 months', decider: 'caller_and_partner', source: 'other', budget: null,
    result: 'qualified', booked: true, price_asks: 0 },

  /* ---------------- whatsapp: monitored 10am-7pm on working days ---------------- */
  // Arrived 7:14pm. Replied 4 Sept 11:47am. Sixteen and a half hours.
  { ref: 'W01', channel: 'whatsapp', at: '2026-09-03T19:14', duration: null, response_sec: 59580,
    name: 'Kiran Mazumdar', locality: 'Viman Nagar', property: '4BHK', sqft: 1800,
    scope: 'Full interiors', state: 'bare_shell', timeline: '2 months',
    decider: 'caller', source: 'referral', referrer: 'Sonali Patel', budget: null,
    result: 'qualified', booked: true, consultation_type: 'site visit', price_asks: 0 },

  { ref: 'W02', channel: 'whatsapp', at: '2026-09-08T14:31', duration: null, response_sec: 157860,
    name: null, locality: null, property: '2BHK', sqft: null,
    scope: 'Asked the per sq ft rate; no project details given', state: 'unknown',
    timeline: null, decider: 'unknown', source: 'other', budget: null,
    result: 'incomplete', booked: false, price_asks: 1,
    note: 'Missed for two days. No reply after the eventual follow-up.' },

  { ref: 'W03', channel: 'whatsapp', at: '2026-09-12T10:45', duration: null, response_sec: 1020,
    name: 'Sunil Yadav', locality: 'Pimple Nilakh', property: '3BHK', sqft: null,
    scope: 'Poora ghar interior design', state: 'lived_in', timeline: '3 months',
    decider: 'caller', source: 'other', budget: null, language: 'hindi',
    result: 'qualified', booked: true, consultation_type: 'site visit', price_asks: 0 },

  { ref: 'W04', channel: 'whatsapp', at: '2026-09-15T15:18', duration: null, response_sec: 1620,
    name: 'Chinmay Kulkarni', locality: 'Chinchwad', property: 'office', sqft: 1200,
    scope: 'Fitout - workstations for 30, two cabins, one meeting room', state: 'bare_shell',
    timeline: '4 months', decider: 'caller', source: 'other', budget: null,
    result: 'qualified', booked: true, consultation_type: 'site visit', price_asks: 0 },

  // Saturday evening. Replied Monday morning. Then nothing - the lead was gone.
  { ref: 'W05', channel: 'whatsapp', at: '2026-09-20T18:44', duration: null, response_sec: 142260,
    name: 'Meena Joshi', locality: 'Baner', property: '2BHK', sqft: null,
    scope: 'Home design - details never established', state: 'unknown', timeline: null,
    decider: 'unknown', source: 'other', budget: null, result: 'incomplete',
    booked: false, price_asks: 0, note: 'Lead lost. No response after two follow-ups.' },

  { ref: 'W06', channel: 'whatsapp', at: '2026-09-17T11:22', duration: null, response_sec: 1140,
    name: 'Tanvi Kulkarni', locality: 'Koregaon Park', property: '3BHK', sqft: null,
    scope: 'End-to-end design, possession next month', state: 'builder_handover',
    timeline: '2 months', decider: 'caller_and_partner', source: 'referral',
    referrer: 'Ashok Bhosale', budget: null, result: 'qualified', booked: true,
    consultation_type: 'site visit', price_asks: 0 },

  { ref: 'W07', channel: 'whatsapp', at: '2026-09-05T16:52', duration: null, response_sec: 63480,
    name: 'Rohit Singh', locality: 'Kothrud', property: 'gym', sqft: 2500,
    scope: 'Gym interiors - modern and high-energy', state: 'bare_shell',
    timeline: '3 months', decider: 'caller', source: 'other', budget: null,
    result: 'declined', decline: 'fitness spaces are out of scope',
    criteria_failed: ['real_project'], booked: false, price_asks: 0 },

  { ref: 'W08', channel: 'whatsapp', at: '2026-09-10T08:44', duration: null, response_sec: 4680,
    name: 'Pradeep Garg', locality: 'Aundh', property: '2BHK', sqft: 850,
    scope: 'Full interiors', state: 'lived_in', timeline: '3 months',
    decider: 'caller', source: 'other', budget: null, result: 'escalated',
    escalation: 'Four days without a reply on an earlier message. Lead highly frustrated.',
    booked: false, price_asks: 0 },

  { ref: 'W09', channel: 'whatsapp', at: '2026-09-25T15:18', duration: null, response_sec: 71400,
    name: 'Neha Deshpande', locality: 'Aundh', property: '3BHK', sqft: null,
    scope: 'Living room and dining, possibly the kitchen - full execution',
    state: 'lived_in', timeline: '3 months', decider: 'caller', source: 'other',
    budget: null, result: 'qualified', booked: true, consultation_type: 'site visit',
    price_asks: 0 },

  { ref: 'W10', channel: 'whatsapp', at: '2026-09-22T18:12', duration: null, response_sec: 57420,
    name: 'Vivek Rao', locality: 'Hinjewadi', property: '3BHK', sqft: null,
    scope: 'Exploring options - no commitment yet', state: 'unknown', timeline: null,
    decider: 'caller', source: 'other', budget: null, result: 'incomplete',
    booked: false, price_asks: 0, note: 'Early-stage interest. Re-engage in 4-6 weeks.' },

  /* ---------------- web form ---------------- */
  // The log does not record when the studio called these back. The figures
  // below are the studio's own stated performance for the period, and every
  // one of them is marked estimated.
  { ref: 'F01', channel: 'web_form', at: '2026-09-01T09:44', duration: null,
    response_sec: 28800, estimated: true,
    name: 'Sumit Bhatt', locality: 'Kalyani Nagar', property: '2BHK', sqft: 920,
    scope: 'Full home - modular kitchen, both bedrooms, living room, home office corner',
    state: 'lived_in', timeline: '3 months', decider: 'caller_and_partner',
    source: 'instagram', budget: null, result: 'qualified', booked: true, price_asks: 0 },

  { ref: 'F02', channel: 'web_form', at: '2026-09-04T19:12', duration: null,
    response_sec: 180000, estimated: true,
    name: 'Laleh Contractor', locality: 'Baner', property: '3BHK', sqft: 1100,
    scope: 'Partial - master bedroom and living room, with execution',
    state: 'builder_handover', timeline: 'flexible', decider: 'caller',
    source: 'referral', referrer: 'Priya Wadia', budget: null, result: 'qualified',
    booked: true, price_asks: 0 },

  { ref: 'F03', channel: 'web_form', at: '2026-09-06T11:18', duration: null,
    response_sec: 97200, estimated: true,
    name: 'Nilesh Dhamdhere', locality: 'Talegaon Dabhade, near Pune',
    property: '3BHK independent house', sqft: 1400,
    scope: 'Everything from scratch, just got possession', state: 'builder_handover',
    timeline: '4 months', decider: 'caller', source: 'google',
    budget: '15-20 lakh for the full home', result: 'declined',
    decline: 'outside service area', criteria_failed: ['service_area'],
    booked: false, price_asks: 0 },

  { ref: 'F04', channel: 'web_form', at: '2026-09-09T14:37', duration: null,
    response_sec: 259200, estimated: true,
    name: 'Rajesh', locality: 'Pune', property: null, sqft: null,
    scope: 'Wants to know the cost of interior design', state: 'unknown',
    timeline: 'as soon as possible', decider: 'unknown', source: 'other',
    budget: 'reasonable', result: 'incomplete', booked: false, price_asks: 1,
    note: 'Form almost entirely blank. No email given.' },

  { ref: 'F05', channel: 'web_form', at: '2026-09-11T10:05', duration: null,
    response_sec: 10800, estimated: true,
    name: 'Sheena Menon', locality: 'Hinjewadi', property: 'office', sqft: 2200,
    scope: 'Workstations for 55, four cabins, a boardroom, two meeting rooms, lounge, pantry',
    state: 'bare_shell', timeline: '4 months', decider: 'caller', source: 'referral',
    referrer: 'Amey Joshi', budget: '60-80 lakh all-in', result: 'qualified',
    booked: true, consultation_type: 'site visit', price_asks: 0 },

  { ref: 'F06', channel: 'web_form', at: '2026-09-14T20:52', duration: null,
    response_sec: 219600, estimated: true,
    name: 'Preethi Nair', locality: 'NIBM', property: '4BHK', sqft: 1950,
    scope: 'Kitchen replacement, three bedrooms, living room flooring and design, a study',
    state: 'lived_in', timeline: '5 months', decider: 'caller_and_partner',
    source: 'press', budget: '35-40 lakh', result: 'qualified', booked: true,
    price_asks: 0, note: 'Shortlisted three studios. Wants an honest conversation about fit.' },

  { ref: 'F07', channel: 'web_form', at: '2026-09-16T15:11', duration: null,
    response_sec: 172800, estimated: true,
    name: null, locality: 'Pune', property: null, sqft: null,
    scope: 'Asked for the per sq ft rate and a price list before enquiring further',
    state: 'unknown', timeline: null, decider: 'unknown', source: 'instagram',
    budget: null, result: 'incomplete', booked: false, price_asks: 1,
    note: 'Anonymous. No project described.' },

  { ref: 'F08', channel: 'web_form', at: '2026-09-18T18:44', duration: null,
    response_sec: 61200, estimated: true,
    name: 'Divya Hegde', locality: 'Wakad', property: '2BHK', sqft: 875,
    scope: 'Living room and kitchen presentable before guests arrive',
    state: 'lived_in', timeline: '3 weeks', decider: 'caller', source: 'google',
    budget: '4-5 lakh', result: 'declined', decline: 'timeline too tight',
    criteria_failed: ['timeline'], booked: false, price_asks: 0 },

  { ref: 'F09', channel: 'web_form', at: '2026-09-20T11:30', duration: null,
    response_sec: 7200, estimated: true,
    name: 'Amol Patil', locality: 'Kondhwa', property: '3BHK', sqft: 1150,
    scope: 'Full home, completely bare', state: 'builder_handover',
    timeline: '5 months', decider: 'caller', source: 'builder',
    referrer: 'Rohan Lifescapes', budget: null, result: 'qualified', booked: true,
    price_asks: 0 },

  { ref: 'F10', channel: 'web_form', at: '2026-09-26T16:22', duration: null,
    response_sec: 144000, estimated: true,
    name: 'Siddharth Gupta', locality: 'Aundh', property: '3BHK', sqft: 1300,
    scope: 'Full home plus two home offices', state: 'lived_in',
    timeline: '2 months', decider: 'caller_and_partner', source: 'linkedin',
    budget: '18-22 lakh', result: 'qualified', booked: true, price_asks: 0 },
]
