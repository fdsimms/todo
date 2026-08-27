import { parseEventText } from '../utils/eventTextParse';

// Fixed so a year-less date resolves against a known "today" rather than
// against whenever the suite happens to run.
const NOW = new Date(2026, 7, 27, 12, 0, 0, 0); // 27 Aug 2026

const MYCHART = `Appointment Details
Appointment Scheduled
You're all set! You can review details of your upcoming appointment below.
New Patient Visit with Abtin Tabaee, MD
Monday September 28, 2026
8:15 AM EDT (Estimated Visit Duration: 15 minutes)
Add to calendar
Weill Cornell Otolaryngology
156 William Street, 11th Floor
New York NY 10038-2609
646-962-3681
Get directions
Prepare for Your Visit`;

const RESERVATION = `Reservation Confirmed
Marea
Party of 4
Friday, October 2, 2026 at 7:30 PM
240 Central Park South
New York, NY 10019
Confirmation #M-88213
Please arrive within 15 minutes of your reservation time.`;

const ITINERARY = `Your trip is booked
Flight: JFK to ORD
Departs 6:05 AM on 9/12/2026
American Airlines 1147
Terminal 8

Hotel
The Langham Chicago
330 N Wabash Ave, Chicago, IL 60611
Check-in: 9/12/2026 3:00 PM
Check-out: 9/15/2026 11:00 AM`;

describe('parseEventText', () => {
  describe('a real appointment page', () => {
    const { event, moreDatesFound } = parseEventText(MYCHART, NOW);

    it('reads the date', () => {
      expect(event?.date).toBe('2026-09-28');
    });

    it('reads the time, ignoring the timezone suffix', () => {
      expect(event?.time).toBe('08:15');
    });

    it('takes the first line that is not page furniture as the title', () => {
      expect(event?.title).toBe('New Patient Visit with Abtin Tabaee, MD');
    });

    it('assembles the address, including the venue name above it', () => {
      expect(event?.location).toBe(
        'Weill Cornell Otolaryngology, 156 William Street, 11th Floor, New York NY 10038-2609',
      );
    });

    it('keeps the phone number as a note', () => {
      expect(event?.notes).toBe('646-962-3681');
    });

    it('does not claim there is more than one event', () => {
      expect(moreDatesFound).toBe(false);
    });
  });

  describe('a restaurant reservation', () => {
    const { event } = parseEventText(RESERVATION, NOW);

    it('reads the date and the time from one line', () => {
      expect(event?.date).toBe('2026-10-02');
      expect(event?.time).toBe('19:30');
    });

    it('names the restaurant rather than the page heading', () => {
      expect(event?.title).toBe('Marea');
    });

    // The bare five-digit ZIP test this replaced called "Confirmation
    // #M-88213" an address.
    it('does not mistake a confirmation number for an address', () => {
      expect(event?.location).toBe('240 Central Park South, New York, NY 10019');
      expect(event?.location).not.toContain('88213');
    });

    it('keeps the confirmation number as a note instead', () => {
      expect(event?.notes).toContain('M-88213');
    });

    // "Marea" is the title, so it must not also be glued onto the front of
    // the address as if it were a venue line.
    it('does not repeat the title inside the location', () => {
      expect(event?.location.startsWith('Marea')).toBe(false);
    });
  });

  describe('a multi-leg itinerary — the case this cannot actually do', () => {
    const { event, moreDatesFound } = parseEventText(ITINERARY, NOW);

    it('reads the first leg', () => {
      expect(event?.date).toBe('2026-09-12');
      expect(event?.time).toBe('06:05');
      expect(event?.title).toBe('Flight: JFK to ORD');
    });

    it('says the text named other dates rather than dropping them quietly', () => {
      expect(moreDatesFound).toBe(true);
    });
  });

  describe('dates', () => {
    const dateOf = (text: string) => parseEventText(text, NOW).event?.date;

    it('reads a month-first written date', () => {
      expect(dateOf('Meeting on September 28, 2026')).toBe('2026-09-28');
    });

    it('reads an abbreviated month, including the four-letter one', () => {
      expect(dateOf('Sep 28 2026')).toBe('2026-09-28');
      expect(dateOf('Sept 28 2026')).toBe('2026-09-28');
    });

    it('reads an ordinal suffix', () => {
      expect(dateOf('October 2nd, 2026')).toBe('2026-10-02');
    });

    it('reads a day-first written date', () => {
      expect(dateOf('28 September 2026')).toBe('2026-09-28');
    });

    it('reads an ISO date', () => {
      expect(dateOf('Scheduled for 2026-09-28')).toBe('2026-09-28');
    });

    it('reads a numeric date month-first, matching the app’s American copy', () => {
      expect(dateOf('9/12/2026')).toBe('2026-09-12');
    });

    it('reads a numeric date day-first when the first number cannot be a month', () => {
      expect(dateOf('13/05/2026')).toBe('2026-05-13');
    });

    it('expands a two-digit year into this century', () => {
      expect(dateOf('9/12/26')).toBe('2026-09-12');
    });

    // The one place this touches "today", and why `now` is injected.
    it('resolves a year-less date to its next occurrence', () => {
      expect(dateOf('Dinner on October 2')).toBe('2026-10-02');
    });

    it('rolls a year-less date already past into next year', () => {
      expect(dateOf('Dinner on March 3')).toBe('2027-03-03');
    });

    it('refuses a date that is not on the calendar', () => {
      expect(dateOf('February 30, 2026')).toBeUndefined();
    });

    it('reads nothing out of text with no date in it', () => {
      expect(parseEventText('Call the dentist about the crown', NOW).event).toBeNull();
    });
  });

  describe('times', () => {
    const timeOf = (text: string) => parseEventText(`October 2, 2026\n${text}`, NOW).event?.time;

    it('reads a 12-hour time', () => {
      expect(timeOf('at 7:30 PM')).toBe('19:30');
    });

    it('reads a 12-hour time with no minutes', () => {
      expect(timeOf('at 7 PM')).toBe('19:00');
    });

    it('reads a 24-hour time', () => {
      expect(timeOf('at 19:30')).toBe('19:30');
    });

    it('handles noon and midnight', () => {
      expect(timeOf('at 12:00 PM')).toBe('12:00');
      expect(timeOf('at 12:00 AM')).toBe('00:00');
    });

    it('takes the start of a range', () => {
      expect(timeOf('7:30 PM - 9:00 PM')).toBe('19:30');
    });

    it('is not fooled by a phone number', () => {
      expect(timeOf('Call 646-962-3681')).toBeNull();
    });

    it('is not fooled by a ZIP+4', () => {
      expect(timeOf('New York NY 10038-2609')).toBeNull();
    });

    it('is not fooled by a duration', () => {
      expect(timeOf('Estimated Visit Duration: 15 minutes')).toBeNull();
    });

    it('leaves an all-day event with no time', () => {
      expect(timeOf('All day')).toBeNull();
    });
  });

  describe('what it declines to guess', () => {
    it('leaves the title empty rather than naming the event after its address', () => {
      const { event } = parseEventText('October 2, 2026\n240 Central Park South\nNew York, NY 10019', NOW);
      expect(event?.title).toBe('');
      expect(event?.location).toBe('240 Central Park South, New York, NY 10019');
    });

    it('leaves the location empty when nothing looks like an address', () => {
      const { event } = parseEventText('Team sync\nOctober 2, 2026 at 10:00 AM\nZoom', NOW);
      expect(event?.location).toBe('');
      expect(event?.title).toBe('Team sync');
    });

    it('returns an event with only a date when that is all the text has', () => {
      const { event } = parseEventText('2026-10-02', NOW);
      expect(event).toEqual({ title: '', date: '2026-10-02', time: null, location: '', notes: '' });
    });

    it('reads nothing out of empty text', () => {
      expect(parseEventText('   ', NOW)).toEqual({ event: null, moreDatesFound: false });
    });
  });
});
