import { Component, importProvidersFrom, OnDestroy, OnInit   } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCardModule  } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from "@angular/common";
import { CalendarModule, CalendarEvent,CalendarMonthViewDay   } from 'angular-calendar';
import * as XLSX from 'xlsx';
import { Firestore, collection, addDoc, setDoc, doc,getDocs,onSnapshot   } from '@angular/fire/firestore';
import { addMonths, subMonths } from 'date-fns';
declare var $: any;
import { DataTablesModule, } from 'angular-datatables';
import { Subject } from 'rxjs';
import * as DataTables from 'datatables.net';
import 'datatables.net'; // Ensure DataTables functionality is available
import { provideHttpClient } from '@angular/common/http';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ReactiveFormsModule } from '@angular/forms';
import { MatNativeDateModule } from '@angular/material/core'; // for default JS Date support
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';

interface Relation {
  relationName: string;
  relationId: string;
}

interface Trades {
  tradeDate: string;
  tradeId: string;
}

interface Table {
  openDate: string;
  tradeNotion: Trades[];
  status: string;
  position: string;
  symbol: string;
  type: string;
  volume: string;
  entry: string;
  sL: string;
  tP: string;
  closeDate: string;
  exit: string;
  commission: string;
  swap: string;
  profit: string;
  netProfit: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    MatSlideToggleModule,
    MatCardModule,
    CommonModule,
    CalendarModule,
    DataTablesModule,
    MatProgressBarModule,
    MatButtonModule,
    MatIconModule,
    FormsModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    MatNativeDateModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})


// @Injectable({ providedIn: 'root' })
export class DashboardComponent {
  viewDate: Date = new Date();
  events: CalendarEvent[] = [];
  locale: string = 'en';
  tableData: Table[] = [];
  rawData: any[] = [];
  dtOptions: any = {}; // Use 'any' or type the object more specifically later
  dtTrigger: Subject<any> = new Subject<any>();
  //uploading progress bar
  uploadProgress: number = 0;
  isUploading: boolean = false;
  showProgressBar = false;
  hideProgressBar = false;
  startDate: Date | null = null;
  endDate: Date | null = null;
  isLoadingChecking = false;
  isLoadingPatching = false;
  progressChecking = 0;
  progressPatching = 0;
  relations: Relation[] = [];
  trades: Trades[] = [];
  showNotionData = false;
  // selectedTradeId: string | null = null;
  selectedTradeId: { [position: string]: string | null } = {};


  constructor(private firestore: Firestore,private http: HttpClient) {

  }

  async ngOnInit() {
    this.dtOptions = {
      destroy: true, 
      paging: true,
      searching: true,
      ordering: true,
      pageLength: 25,
      processing: true, // Show a loading spinner while data is being processed
      responsive: true,
			keys: true
    };

    // this.loadTradesRealtime(); // Start listening immediately
    await this.loadTrades(); // Wait for trades to load
    this.addTradesToCalendar();

    // this.dtTrigger.next(null);// Emit a value to trigger the DataTable rendering | Enable DataTable feature

  }

  ngAfterViewInit() {
    // $('#myTable').DataTable(); // Apply DataTables after view is ready
  }

  ngOnDestroy(): void {
    this.dtTrigger.unsubscribe();
     // Clean up the DataTable when the component is destroyed
     if ($.fn.dataTable.isDataTable('#myTable')) {
        $('#myTable').DataTable().destroy();
     }
  }
  
  addMonth(date: Date): Date {
    return addMonths(date, 1);
  }
  
  subMonth(date: Date): Date {
    return subMonths(date, 1);
  }

 addTradesToCalendar() {
  // console.log("tableData::"+this.tableData)
    this.tableData.forEach(row => {
      const tradeDateString = row.openDate; // Column 0: the date string
      const symbol = row.symbol;           // Column 2: symbol
      const type = row.position;             // Column 3: buy/sell
  
      const tradeDate = this.parseTradeDate(tradeDateString);
      
      if (tradeDate) {
        this.events = [
          ...this.events,
          {
            start: tradeDate,
            title: `${type.toUpperCase()} ${symbol}`,
            color: {
              primary: type.toLowerCase() === 'buy' ? '#1e90ff' : '#ad2121', // blue for buy, red for sell
              secondary: '#FAE3E3'
            },
            allDay: true,
            meta: {
              position: row.position,
              symbol: row.symbol,
              type: row.type,
              volume: parseFloat(row.volume),
              openPrice: parseFloat(row.entry),
              stopLoss: parseFloat(row.sL),
              takeProfit: parseFloat(row.tP),
              closeTime: new Date(row.closeDate.replace(' ', 'T')),
              closePrice: parseFloat(row.exit),
              commission: parseFloat(row.commission),
              swap: parseFloat(row.swap),
              profit: parseFloat(row.profit),
            }
          }
        ];
      
      }
    });
  }

  getPnLColor(day: CalendarMonthViewDay): string {
    if (!day.events.length) return 'bg-white';
    const pnl = day.events.reduce((sum, e) => sum + (e.meta?.profit || 0), 0);
    if (pnl > 0) return 'bg-green-100';
    if (pnl < 0) return 'bg-red-100';
    return 'bg-gray-100';
  }

  countWins(events: any[]): number {
    return events.filter(event => event.meta?.profit > 0).length;
  }
  
  countLosses(events: any[]): number {
    return events.filter(event => event.meta?.profit < 0).length;
  }
  
  totalProfit(events: any[]): number {
    console.log(events);
    return events
      .filter(event => event.meta?.profit > 0)
      .reduce((sum, event) => sum + (event.meta?.profit || 0), 0)
      .toFixed(2);
  }
  
  totalLoss(events: any[]): number {
    return events
      .filter(event => event.meta?.profit < 0)
      .reduce((sum, event) => sum + (event.meta?.profit || 0), 0)
      .toFixed(2);
  }
  parseTradeDate(dateStr: string): Date | null {
    // MT5 format is like "2025.03.25 09:10:25"
    const parts = dateStr.split(' ');
    if (parts.length !== 2) return null;
  
    const dateParts = parts[0].split('.');
    const timeParts = parts[1].split(':');
  
    if (dateParts.length !== 3 || timeParts.length !== 3) return null;
  
    return new Date(
      parseInt(dateParts[0]),  // Year
      parseInt(dateParts[1]) - 1, // Month (0-based)
      parseInt(dateParts[2]),  // Day
      parseInt(timeParts[0]),  // Hours
      parseInt(timeParts[1]),  // Minutes
      parseInt(timeParts[2])   // Seconds
    );
  }

  onDayClicked(date: Date) {
    alert('Clicked: ' + date.toDateString());
  }

async onPaste(event: ClipboardEvent): Promise<void> {
    const clipboardItems = event.clipboardData?.items;
    if (clipboardItems) {
      for (let i = 0; i < clipboardItems.length; i++) {
        const item = clipboardItems[i];
        if (item.type === 'text/plain' || item.type === 'text/tab-separated-values') {
          const text = event.clipboardData?.getData('text/plain');
          if (text) {
            this.parseTableData(text);
          }
        }
      }
      //If you're refreshing data multiple times (e.g., after upload or load), don't unsubscribe and reuse the old Subject. Instead, recreate it:
      this.dtTrigger.unsubscribe();
      this.dtTrigger = new Subject();
      this.dtTrigger.next(null)
      console.log("printing to DT")
    }
  }

  parseTableData(data: string): void {
    // Example: Handle pasted tab-separated or comma-separated values (CSV)
    // const rows = data.split('\n').map(row => row.split('\t')); // For tab-separated values
    // Alternatively, for CSV: const rows = data.split('\n').map(row => row.split(','));
    const rows = data
    .split('\n')
    .map((row: string) => row.trim()) 
    .filter((row: string) => row.length > 0) // Remove empty lines
    .map((row: string) => {
      const cells = row.split('\t');
      
      // Add 5 hours to datetime strings at column 0 and 8
      [0, 8].forEach(index => {
        if (cells[index]) {
          const [datePart, timePart] = cells[index].split(' ');
          const [year, month, day] = datePart.split('.').map(Number);
          const [hour, minute, second] = timePart.split(':').map(Number);

          const dateObj = new Date(year, month - 1, day, hour, minute, second);
          dateObj.setHours(dateObj.getHours() + 5);

          const formattedDate = `${String(dateObj.getMonth() + 1).padStart(2, '0')}.${String(dateObj.getDate()).padStart(2, '0')}.${dateObj.getFullYear()} ${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;
          cells[index] = formattedDate;
        }
      });

      // Define which columns should be numbers
      // Indices for: Volume, Price, S/L, T/P, Close Price, Commission, Swap, Profit
      const numberColumns = [4, 5, 6, 7, 9, 10, 11, 12]; 
      // Loop and convert specific columns
      numberColumns.forEach(index => {
        if (cells[index] !== undefined) {
          cells[index] = cells[index].replace(/\s+/g, ''); // Remove spaces & parse to number
        }
      });

      //add 13th column-Net Profit
      cells[13] = (parseFloat(cells[10]) + parseFloat(cells[12])).toFixed(2)

      // ✅ Insert null at position 1 and 2 (for displaying notion data later)
      cells.splice(1, 0, "");   // Insert at index 1
      cells.splice(2, 0, ""); // Insert at index 2 (after symbol)
      return cells;
    }); 

    console.log(rows)
    // this.tableData = rows;
    this.tableData = rows.map(row => ({
      openDate: row[0],
      tradeNotion: [],
      status: row[2],
      position: row[3],
      symbol: row[4],
      type: row[5],
      volume: row[6],
      entry: row[7],
      sL: row[8],
      tP: row[9],
      closeDate: row[10],
      exit: row[11],
      commission: row[12],
      swap: row[13],
      profit: row[14],
      netProfit: row[15]
    } as Table)); //The 'as Table' makes sure it matches the interface
  }

  onFileSelected(event: any): void {
    const file = event.target.files[0];  // Get the selected file
    if (file) {
      this.readExcelFile(file);  // Parse the Excel file
    }
  }

    // This method reads the Excel file and converts it into a usable format
    readExcelFile(file: File): void {
      const reader = new FileReader();
  
      reader.onload = (e: any) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
  
        // Assume that the first sheet contains the data
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
  
        // Convert the sheet to a 2D array (array of rows and columns)
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
        // Store the raw data for later reference
        this.rawData = jsonData;
  
        // Find the start and end rows based on the text in the first column
        const startRowIndex = this.findRowIndex('Positions')+1;
        const endRowIndex = this.findRowIndex('Orders')-1;
  
        // Slice the data between "Positions" and "Orders"
        if (startRowIndex !== -1 && endRowIndex !== -1 && endRowIndex > startRowIndex) {
          this.tableData = this.rawData.slice(startRowIndex, endRowIndex + 1); // Include "Orders" row
        } else {
          console.error('Start or end row not found');
        }
  
        // Optional: Show the result in the console for debugging
        console.log('Filtered data:', this.tableData);
      };
  
      // Read the file as an array buffer
      reader.readAsArrayBuffer(file);
    }

    // This method finds the row index of the first occurrence of the given text in the first column
  findRowIndex(searchText: string): number {
    for (let i = 0; i < this.rawData.length; i++) {
      if (this.rawData[i][0] && this.rawData[i][0].toString().toLowerCase() === searchText.toLowerCase()) {
        return i; // Return the index of the row where the text is found
      }
    }
    return -1; // Return -1 if the text is not found
  }

  // Optional: Implement file upload to a server or Firebase
onUpload(): void {
  console.log('Uploading data...', this.tableData);
  const collectionRef = collection(this.firestore, 'trades');

  this.showProgressBar = true;
  this.hideProgressBar = false;
  this.isUploading = true;
  this.uploadProgress = 0;

  const total = this.tableData.length;
  let uploaded = 0;

  this.tableData.forEach(async (row) => {
    try {
      const documentId = row.openDate;
      const docRef = doc(collectionRef, documentId);
      await setDoc(docRef, {
        rowData: row
      });
      uploaded++;
      this.uploadProgress = Math.round((uploaded / total) * 100);
    } catch (error) {
      console.error('Error uploading row: ', error);
    }

    if (uploaded === total) {
      setTimeout(() => {
        this.isUploading = false;
        this.hideProgressBar = true; // Triggers CSS fade-out
        this.showProgressBar = false;
        this.uploadProgress = 0;
      }, 2000); // Wait for CSS transition
    }
  });
}
  
  loadTradesRealtime() {
    const collectionRef = collection(this.firestore, 'trades');
    onSnapshot(collectionRef, (querySnapshot) => {
      const loadedData: any[] = [];
  
      querySnapshot.forEach((doc) => {
        loadedData.push({
          id: doc.id,
          ...doc.data()
        });
      });
      console.log('Real-time trades:', loadedData);
      this.tableData = loadedData;
    });
  }

  loadTrades(): Promise<void> {
    return new Promise((resolve, reject) => {
      const tradesRef = collection(this.firestore, 'trades');
      getDocs(tradesRef).then((querySnapshot) => {
        this.tableData = querySnapshot.docs.map(doc => doc.data()['rowData']);
        console.log(this.tableData)
        resolve(); // Notify that loading is done
      }).catch((error) => {
        console.error('Error loading trades:', error);
        reject(error);
      });
    });
  }
  
  copyColumns(index1: number, index2: number): void {
    // const combinedValues = this.tableData.map(row => {
    //   return `${row[index1]}\t${row[index2]}`; // tab-separated
    // });
    // const textToCopy = combinedValues.join('\n');
    // navigator.clipboard.writeText(textToCopy).then(() => {
    //   alert('Two columns copied to clipboard!');
    // });
  }
  
  async getAllPagesFromDB(){ 
    const formattedStartDate = this.startDate
      ? `${this.startDate.getFullYear()}-${String(this.startDate.getMonth() + 1).padStart(2, '0')}-${String(this.startDate.getDate()).padStart(2, '0')}`
      : '';
    const formattedEndDate = this.endDate
      ? `${this.endDate.getFullYear()}-${String(this.endDate.getMonth() + 1).padStart(2, '0')}-${String(this.endDate.getDate()).padStart(2, '0')}`
      : '';
    this.isLoadingPatching = true;
    this.progressPatching = 0;

    const body = {
      "filter": {
        "and": [
          {
            "property": "Date",
            "date": {
              "on_or_after": formattedStartDate
            }
          },
          {
            "property": "Date",
            "date": {
              "on_or_before": formattedEndDate
            }
          }
        ]
      }
    }
    this.http.post("http://localhost:3000/api/getAllPagesFromDB", body)
    .subscribe({
      next: async (res:any) => {
        // console.log(res)
        this.trades = [];
        res.results.map((prop: any) => {
          const d = new Date(prop.properties.Date.date.start);
           this.trades.push({ tradeDate: `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`, 
                              tradeId: prop.id })
        });
        const total = this.trades.length;
        let completed = 0;
      // console.log(this.trades)
      // return

        for (const trade of this.trades) {
          // console.log(trade)
          let relationId = this.relations.filter(rel => rel.relationName === trade.tradeDate)[0].relationId
          const body = {
            "payload": {
              "properties": {
                "Activity log": {
                  "relation": [
                    {
                      "id": relationId
                    }
                  ]
                }
              }
            },
            "url":trade.tradeId
          }
          // console.log(body)
          try {
            const res: any = await firstValueFrom(
              this.http.patch("http://localhost:3000/api/patchRelationIdToTrade", body) //Patching
            );
            if (res) {
              console.log("Patching successful: "+trade.tradeDate)
            }else{
              console.log("Patching failed: "+trade.tradeDate)
            }
            completed++;
            this.progressPatching = Math.floor((completed / total) * 100);

          } catch (error) {
            console.error('Error patching:', error);
          }
        }
        this.isLoadingPatching = false;
        this.isLoadingChecking = false;
      },
      error: (err) => {
        console.error('Error:', err)
      }
    });
  }

  delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async checkAndCreateRelationId(){
    if(!this.endDate){
      return
    }
    this.isLoadingChecking = true;
    this.isLoadingPatching = true;
    this.progressChecking = 0;
    this.progressPatching = 0;
    const dateRange: string[] = [];
    for (
      let d = new Date(this.startDate ?? '');
      d <= (this.endDate ?? '');
      d.setDate(d.getDate() + 1)
    ) {
      const dayOfWeek = d.getDay();
      // Skip weekends (0 = Sunday, 6 = Saturday)
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue;
      }
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const year = d.getFullYear();
      dateRange.push(`${month}-${day}-${year}`);
    }
    const total = dateRange.length;
    let completed = 0;

    for (const date of dateRange) {
       const body = {
          "filter": {
            "property": "Name",
            "title": {
              "equals": date
            }
          }
        }
        try {
          const res: any = await firstValueFrom(
            this.http.post("http://localhost:3000/api/getRelationName", body)
          );

          if (res.results.length > 0) {
            console.log("RelationName already exists for", date);
            this.relations.push({ relationName: date, relationId: res.results[0].id })
          } else {
            console.log('done checking:', date);
            await this.createRelationId(date); // make this async if needed
          }
          completed++;
          this.progressChecking = Math.floor((completed / total) * 100);
          
          // await this.delay(300); // optional
        } catch (error) {         
          console.error('Error checking relation for', date, error);
        }
    }
    console.log('All dates checked');
   
    // console.log(this.relations)
    this.getAllPagesFromDB() //Patching relationIds to ActivityLog
  }

  async createRelationId(dateName:string): Promise<any>{
    const body = {
      "parent": {
        "database_id": "5e00bcb25c3d4276b1de54de3576894a"
      },
      "properties": {
        "Name": {
          "title": [
            {
              "text": {
                "content": dateName
              }
            }
          ]
        }
      }
    }
    const res: any = await firstValueFrom(
      this.http.post("http://localhost:3000/api/createRelationId", body)
    );
    if (res) {
      this.relations = []
      this.relations.push({ relationName: dateName, relationId: res.id })
      console.log("created successful:"+dateName);
    } 

  }

  async compareToNotion(){
    //for every rows in table, get the notion trades page using OpenDate (as a uniqueID)
    for (const row of this.tableData) {
      const originalDateStr = row.openDate; // e.g. "07.04.2025 15:37"
      const [datePart, timePart] = originalDateStr.split(' ');
      const [month, day, year] = datePart.split('.').map(Number);
      const [hour, minute] = timePart.split(':').map(Number);

      // Create the date in local time (assumes you are in GMT+8 like Philippines)
      const date = new Date(year, month - 1, day, hour, minute);
      const isoDate = this.formatToNotionDate(date,"yyyymmdd");;
      const body = {
        "filter": {
          "property": "Date",  // exact name of the Date property in Notion
          "date": {
            "equals": isoDate
          }
        }
      }
      const res: any = await firstValueFrom(
        this.http.post("http://localhost:3000/api/getAllPagesFromDB", body)
      );
      if (res.results && res.results.length > 0) {
        // console.log("Matched found: "+res.results[0].properties["Daily Reflection 📆"])
        // console.log("Matched found:",res.results[0].id)
        row.tradeNotion = [{tradeDate: "", tradeId: res.results[0].id}];
        row.status = "Matched"
      }else{
        row.status = "Unmatched"
        // console.log('No Matched found for: '+isoDate, error);
          const tradesForUnmatched = await this.getTradesUnmatched(isoDate)
          row.tradeNotion = tradesForUnmatched.map((trade: Trades) =>
            trade
          );
      }    
    }

  }

// Helper function to format the date; Manually format to ISO with +08:00 timezone
 formatToNotionDate(date: Date,dateFormat:String): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  
  return (dateFormat === "yyyymmdd")
  ? `${yyyy}-${mm}-${dd}T${hh}:${min}:00+08:00`
  : `${yyyy}-${dd}-${mm}T${hh}:${min}:00+08:00`;
}

  async getTradesUnmatched(isoDate:any): Promise<any>{
    console.log(isoDate)
    const targetTime = new Date(isoDate); //"2025-07-04T15:37:00+08:00"
    // Subtract 10 minutes
    const from = new Date(targetTime.getTime() - 10 * 60 * 1000);
    // Add 30 minutes
    const to = new Date(targetTime.getTime() + 30 * 60 * 1000);
    const fromISO = this.formatToNotionDate(from,"yyyymmdd");
    const toISO = this.formatToNotionDate(to,"yyyymmdd");
   
    const body = {
      "filter": {
        "and": [
          {
            "property": "Date",
            "date": {
              "on_or_after": fromISO
            }
          },
          {
            "property": "Date",
            "date": {
              "on_or_before": toISO
            }
          }
        ]
      }
    }
    const res: any = await firstValueFrom(
      this.http.post("http://localhost:3000/api/getAllPagesFromDB", body));

    const tradesFoundForUnmatched:Trades[] = []
     if (res.results && res.results.length > 0) {
        res.results.map((prop: any) => {
          const d = new Date(prop.properties.Date.date.start);
          const hh = String(d.getHours()).padStart(2, '0');
          const min = String(d.getMinutes()).padStart(2, '0');
          tradesFoundForUnmatched.push({ tradeDate: `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}.${d.getFullYear()} ${hh}:${min}`, 
          tradeId: prop.id })
        });
        console.log(tradesFoundForUnmatched)
      }else{
        console.log("Not tradesFoundForUnmatched.")
      }
      return tradesFoundForUnmatched
  }

  populateData(){
      console.log(this.tableData)
  }

  chooseUnmatchedTrade(tradeNotion: Trades, row: Table, rowIndex: number) {
    // Toggle the selected button for this row
    if (this.selectedTradeId[rowIndex] === tradeNotion.tradeId) {
      this.selectedTradeId[rowIndex] = null;
      row.status = "Unmatched"; // Unselecting = revert to unmatched
    } else {
      this.selectedTradeId[rowIndex] = tradeNotion.tradeId;
      row.status = "Matched"; // Selecting = mark as matched
    }
    localStorage.setItem(rowIndex.toString(), JSON.stringify(row.tradeNotion));
    row.tradeNotion = [{tradeDate: tradeNotion.tradeDate, tradeId: tradeNotion.tradeId},{tradeDate: "", tradeId: ""}];
  }

  revertTradeNotion(row: Table, rowIndex: number) {
    // Revert the tradeNotion to an empty array
    row.tradeNotion = [];
    this.selectedTradeId[rowIndex] = null; // Reset the selected trade ID for this row
    row.status = "Unmatched"; // Set status back to unmatched
    row.tradeNotion = localStorage.getItem(rowIndex.toString()) ? JSON.parse(localStorage.getItem(rowIndex.toString()) || '[]') : [];
    localStorage.removeItem(rowIndex.toString()); // Clear local storage if needed
  }

}

