import { TestSession } from '../src/types/scada';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export class DatabaseService {
  private dbFilePath: string = '';
  private sessions: TestSession[] = [];

  constructor() {
    try {
      const userDataPath = app ? app.getPath('userData') : process.cwd();
      this.dbFilePath = path.join(userDataPath, 'joma_scada_history.json');
      this.loadData();
    } catch (err) {
      console.warn('Database initialization warning:', err);
      this.dbFilePath = path.join(process.cwd(), 'joma_scada_history.json');
      this.loadData();
    }
  }

  private loadData() {
    try {
      if (fs.existsSync(this.dbFilePath)) {
        const raw = fs.readFileSync(this.dbFilePath, 'utf-8');
        this.sessions = JSON.parse(raw);
      } else {
        this.sessions = [];
        this.saveData();
      }
    } catch (err) {
      console.error('Failed to load DB file:', err);
      this.sessions = [];
    }
  }

  private saveData() {
    try {
      fs.writeFileSync(this.dbFilePath, JSON.stringify(this.sessions, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save DB file:', err);
    }
  }

  public getSessions(): TestSession[] {
    return [...this.sessions];
  }

  public saveSession(session: TestSession): boolean {
    const existingIndex = this.sessions.findIndex(s => s.id === session.id);
    if (existingIndex >= 0) {
      this.sessions[existingIndex] = session;
    } else {
      this.sessions.unshift(session); // Add newest at top
    }
    this.saveData();
    return true;
  }

  public deleteSession(id: string): boolean {
    this.sessions = this.sessions.filter(s => s.id !== id);
    this.saveData();
    return true;
  }
}
