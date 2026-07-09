import { loadFixture } from '@/lib/load-fixture'
import { taskSchema, type Task } from './schema'
import tasksData from './tasks.json'

function parseTask(row: (typeof tasksData)[number]): Task {
  const parsed = taskSchema.safeParse(row)
  if (!parsed.success) {
    throw new Error(parsed.error.message)
  }
  return parsed.data
}

export const tasks: Task[] = loadFixture(tasksData, parseTask, 'tasks')
