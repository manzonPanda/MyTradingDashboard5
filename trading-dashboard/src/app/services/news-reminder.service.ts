import { Injectable } from '@angular/core';

interface NewsEvent {
  date: string;
  time: string;
  currency: string;
  event: string;
  impact: string;
}

interface ReminderTimeout {
  timeoutId: number;
  newsEvent: NewsEvent;
  reminderInterval: number;
}

@Injectable({
  providedIn: 'root'
})
export class NewsReminderService {
  private reminderTimeouts: ReminderTimeout[] = [];
  private reminderIntervals = [5, 3, 1]; // minutes before news (5min, 3min, 1min) - sound notifications
  private sendNotificationCallback: ((title: string, body: string) => void) | null = null;
  private uiReminderCallback: ((events: NewsEvent[], minutesBefore: number) => void) | null = null;

  constructor() {}

  /**
   * Set the callback function to send notifications
   */
  setSendNotificationCallback(callback: (title: string, body: string) => void) {
    this.sendNotificationCallback = callback;
  }

  /**
   * Set the UI reminder callback to trigger in-app alerts/modals
   */
  setUiReminderCallback(callback: (events: NewsEvent[], minutesBefore: number) => void) {
    this.uiReminderCallback = callback;
  }

  /**
   * Schedule reminders for all news events (only current day)
   */
  scheduleAllReminders(newsData: NewsEvent[]) {
    // Clear existing reminders
    this.clearAllReminders();

    // Filter for current day news only
    const currentDayNews = this.filterCurrentDayNews(newsData);

    // Group events by date/time to combine reminders
    this.scheduleGroupedReminders(currentDayNews);

    console.log(`📅 Scheduled reminders for ${currentDayNews.length} current day news events (out of ${newsData.length} total)`);
  }

  /**
   * Schedule reminders for grouped events (combines same-time events)
   */
  private scheduleGroupedReminders(newsEvents: NewsEvent[]) {
    // Group events by date/time
    const groupedByTime = this.groupEventsByDateTime(newsEvents);

    Object.entries(groupedByTime).forEach(([dateTimeKey, events]) => {
      const firstEvent = events[0];
      const newsDateTime = this.parseNewsDateTime(firstEvent);

      if (!newsDateTime) {
        console.warn('⚠️ Could not parse date/time for news group:', events);
        return;
      }

      const now = new Date();

      // Only schedule reminders for future events
      if (newsDateTime <= now) {
        return;
      }

      this.reminderIntervals.forEach(intervalMinutes => {
        const reminderTime = new Date(newsDateTime.getTime() - (intervalMinutes * 60 * 1000));

        // Only schedule if reminder time is in the future
        if (reminderTime > now) {
          const timeoutDuration = reminderTime.getTime() - now.getTime();

          const timeoutId = window.setTimeout(() => {
            this.sendCombinedReminder(events, intervalMinutes);
          }, timeoutDuration);

          // Store with first event as reference
          this.reminderTimeouts.push({
            timeoutId,
            newsEvent: firstEvent,
            reminderInterval: intervalMinutes
          });

          if (events.length === 1) {
            console.log(`⏰ Scheduled ${intervalMinutes}min reminder for ${firstEvent.event} at ${reminderTime.toLocaleTimeString()}`);
          } else {
            console.log(`⏰ Scheduled ${intervalMinutes}min combined reminder for ${events.length} events at ${reminderTime.toLocaleTimeString()}`);
          }
        }
      });
    });
  }

  /**
   * Group events by their date/time
   */
  private groupEventsByDateTime(newsEvents: NewsEvent[]): { [key: string]: NewsEvent[] } {
    const grouped: { [key: string]: NewsEvent[] } = {};

    newsEvents.forEach(event => {
      const key = `${event.date}-${event.time}`;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(event);
    });

    return grouped;
  }

  /**
   * Send a combined reminder notification for multiple events at the same time
   */
  private sendCombinedReminder(events: NewsEvent[], minutesBefore: number) {
    let title: string;
    let body: string;

    if (events.length === 1) {
      // Single event - use original format
      const event = events[0];
      title = `📈 Forex News Alert - ${minutesBefore}min`;
      body = `${event.currency} | ${event.event} in ${minutesBefore} minute${minutesBefore > 1 ? 's' : ''} (${event.time})`;
    } else {
      // Multiple events - create combined notification
      const currencies = [...new Set(events.map(e => e.currency))].join(', ');
      const time = events[0].time; // All events have same time

      title = `📈 ${events.length} Forex News Events - ${minutesBefore}min`;

      // Create compact body with all events
      const eventTitles = events.map(e => `${e.currency}: ${e.event}`).join(' | ');
      body = `${eventTitles} in ${minutesBefore} minute${minutesBefore > 1 ? 's' : ''} (${time})`;

      // If body is too long, create a shorter version
      if (body.length > 150) {
        body = `${currencies} | ${events.length} events in ${minutesBefore} minute${minutesBefore > 1 ? 's' : ''} (${time})`;
      }
    }

    console.log(`🔔 Sending ${events.length > 1 ? 'combined ' : ''}reminder: ${title} - ${body}`);

    if (this.sendNotificationCallback) {
      this.sendNotificationCallback(title, body);
    } else {
      console.warn('⚠️ No notification callback set');
    }

    // Trigger in-app UI callback (sound + modal)
    if (this.uiReminderCallback) {
      this.uiReminderCallback(events, minutesBefore);
    }

    // Remove timeouts for this reminder interval
    this.reminderTimeouts = this.reminderTimeouts.filter(
      timeout => timeout.reminderInterval !== minutesBefore ||
                !events.some(event => timeout.newsEvent.date === event.date && timeout.newsEvent.time === event.time)
    );
  }

  /**
   * Parse news date and time into a proper Date object
   */
  private parseNewsDateTime(newsEvent: NewsEvent): Date | null {
    try {
      // Parse date format "Tue Aug 5" or "Thu Aug 7"
      const today = new Date();
      const currentYear = today.getFullYear();
      
      // Handle different date formats
      let newsDate: Date;
      
      if (newsEvent.date.includes('Today')) {
        newsDate = new Date(today);
      } else if (newsEvent.date.includes('Tomorrow')) {
        newsDate = new Date(today);
        newsDate.setDate(today.getDate() + 1);
      } else {
        // Try to parse formats like "Tue Aug 5"
        const dateParts = newsEvent.date.trim().split(' ');
        
        if (dateParts.length >= 3) {
          // Format: "Tue Aug 5"
          const monthName = dateParts[1];
          const day = parseInt(dateParts[2]);
          
          const monthIndex = this.getMonthIndex(monthName);
          if (monthIndex === -1) return null;
          
          newsDate = new Date(currentYear, monthIndex, day);
        } else if (dateParts.length === 2) {
          // Format: "Aug 5"
          const monthName = dateParts[0];
          const day = parseInt(dateParts[1]);
          
          const monthIndex = this.getMonthIndex(monthName);
          if (monthIndex === -1) return null;
          
          newsDate = new Date(currentYear, monthIndex, day);
        } else {
          return null;
        }
      }

      // Parse time format "10:30" or "3:45"
      if (!newsEvent.time || newsEvent.time === '--:--') {
        return null;
      }

      const timeParts = newsEvent.time.split(':');
      if (timeParts.length !== 2) return null;

      const hours = parseInt(timeParts[0]);
      const minutes = parseInt(timeParts[1]);

      if (isNaN(hours) || isNaN(minutes)) return null;

      newsDate.setHours(hours, minutes, 0, 0);

      // If the date is in the past, assume it's for next year
      if (newsDate < today) {
        newsDate.setFullYear(currentYear + 1);
      }

      return newsDate;
    } catch (error) {
      console.error('Error parsing news date/time:', error);
      return null;
    }
  }

  /**
   * Get month index from month name
   */
  private getMonthIndex(monthName: string): number {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    
    return months.findIndex(month => 
      month.toLowerCase() === monthName.toLowerCase()
    );
  }

  /**
   * Clear all scheduled reminders
   */
  clearAllReminders() {
    this.reminderTimeouts.forEach(timeout => {
      clearTimeout(timeout.timeoutId);
    });
    this.reminderTimeouts = [];
    console.log('🧹 Cleared all news reminders');
  }

  /**
   * Filter news events for current day only
   */
  private filterCurrentDayNews(newsData: NewsEvent[]): NewsEvent[] {
    const today = new Date();
    const todayDay = today.getDay(); // 0=Sunday, 1=Monday, etc.

    return newsData.filter(news => {
      const newsDateTime = this.parseNewsDateTime(news);
      if (!newsDateTime) return false;

      // Check if news is for today
      const newsDay = newsDateTime.getDay();
      const isSameDay = newsDay === todayDay;

      // Also check if news date string contains "Today"
      const isToday = news.date.includes('Today') || isSameDay;

      return isToday;
    });
  }

  /**
   * Check if a specific news event has active reminders
   */
  isNewsReminderActive(newsEvent: NewsEvent): boolean {
    const newsDateTime = this.parseNewsDateTime(newsEvent);
    if (!newsDateTime) return false;

    const today = new Date();
    const newsDay = newsDateTime.getDay();
    const todayDay = today.getDay();

    // Only current day news can have active reminders
    const isSameDay = newsDay === todayDay || newsEvent.date.includes('Today');

    if (!isSameDay) return false;

    // Check if we have any scheduled timeouts for this news time slot
    return this.reminderTimeouts.some(timeout =>
      timeout.newsEvent.date === newsEvent.date &&
      timeout.newsEvent.time === newsEvent.time
    );
  }

  /**
   * Get status of scheduled reminders
   */
  getReminderStatus(): { total: number; scheduled: number } {
    return {
      total: this.reminderTimeouts.length,
      scheduled: this.reminderTimeouts.length
    };
  }

  /**
   * Enable/disable reminders for specific impact levels
   */
  // (removed unused updateReminderSettings)
}
