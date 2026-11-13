import type { Project } from './project'

export interface HistoryEntry { project: Project; label: string }
export interface HistoryState { past: HistoryEntry[]; future: HistoryEntry[] }
export class ProjectHistory {
  state: HistoryState = { past: [], future: [] }
  private key = ''
  private time = 0
  record(project: Project, label: string, key = '') {
    const now = Date.now()
    if (!key || key !== this.key || now - this.time > 700) {
      this.state = { past: [...this.state.past.slice(-49), { project, label }], future: [] }
    } else this.state = { ...this.state, future: [] }
    this.key = key
    this.time = now
  }
  restore(state?: HistoryState) {
    this.state = state ?? { past: [], future: [] }
    this.key = ''
  }
  undo(current: Project) {
    const entry = this.state.past.at(-1)
    if (!entry) return null
    this.state = { past: this.state.past.slice(0, -1), future: [...this.state.future, { project: current, label: entry.label }] }
    this.key = ''
    return entry.project
  }
  redo(current: Project) {
    const entry = this.state.future.at(-1)
    if (!entry) return null
    this.state = { future: this.state.future.slice(0, -1), past: [...this.state.past, { project: current, label: entry.label }] }
    this.key = ''
    return entry.project
  }
}
