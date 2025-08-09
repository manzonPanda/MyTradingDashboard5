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
  private reminderIntervals = [60, 30, 15, 10, 8, 5, 3, 1]; // minutes before news
  private sendNotificationCallback: ((title: string, body: string) => void) | null = null;

  constructor() {}

  /**
   * Set the callback function to send notifications
   */
  setSendNotificationCallback(callback: (title: string, body: string) => void) {
    this.sendNotificationCallback = callback;
  }

  /**
   * Schedule reminders for all news events (only current day)
   */
  scheduleAllReminders(newsData: NewsEvent[]) {
    // Clear existing reminders
    this.clearAllReminders();

    // Filter for current day news only
    const currentDayNews = this.filterCurrentDayNews(newsData);

    // Schedule new reminders only for current day
    currentDayNews.forEach(news => {
      this.scheduleRemindersForNews(news);
    });

    console.log(`📅 Scheduled reminders for ${currentDayNews.length} current day news events (out of ${newsData.length} total)`);
  }

  /**
   * Schedule reminders for a single news event
   */
  private scheduleRemindersForNews(newsEvent: NewsEvent) {
    const newsDateTime = this.parseNewsDateTime(newsEvent);
    
    if (!newsDateTime) {
      console.warn('⚠️ Could not parse date/time for news:', newsEvent);
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
          this.sendReminder(newsEvent, intervalMinutes);
        }, timeoutDuration);

        this.reminderTimeouts.push({
          timeoutId,
          newsEvent,
          reminderInterval: intervalMinutes
        });

        console.log(`⏰ Scheduled ${intervalMinutes}min reminder for ${newsEvent.event} at ${reminderTime.toLocaleTimeString()}`);
      }
    });
  }

  /**
   * Send a reminder notification
   */
  private sendReminder(newsEvent: NewsEvent, minutesBefore: number) {
    const title = `📈 Forex News Alert - ${minutesBefore}min`;
    const body = `${newsEvent.currency} | ${newsEvent.event} in ${minutesBefore} minute${minutesBefore > 1 ? 's' : ''} (${newsEvent.time})`;

    console.log(`🔔 Sending reminder: ${title} - ${body}`);

    if (this.sendNotificationCallback) {
      this.sendNotificationCallback(title, body);
    } else {
      console.warn('⚠️ No notification callback set');
    }

    // Remove this timeout from our tracking array
    this.reminderTimeouts = this.reminderTimeouts.filter(
      timeout => !(timeout.newsEvent === newsEvent && timeout.reminderInterval === minutesBefore)
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

    // Check if we have any scheduled timeouts for this news
    return this.reminderTimeouts.some(timeout =>
      timeout.newsEvent.date === newsEvent.date &&
      timeout.newsEvent.time === newsEvent.time &&
      timeout.newsEvent.event === newsEvent.event
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
  updateReminderSettings(enabledImpacts: string[]) {
    // This could be extended to filter by impact level
    console.log('📊 Updated reminder settings for impacts:', enabledImpacts);
  }
}
