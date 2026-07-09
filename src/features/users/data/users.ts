import { loadFixture } from '@/lib/load-fixture'
import type { User, UserStatus, UserRole } from './schema'
import usersData from './users.json'

const STATUS_VALUES: readonly UserStatus[] = [
  'active',
  'inactive',
  'invited',
  'suspended',
]
const ROLE_VALUES: readonly UserRole[] = [
  'superadmin',
  'admin',
  'manager',
  'cashier',
]

function isUserStatus(v: string): v is UserStatus {
  return (STATUS_VALUES as readonly string[]).includes(v)
}
function isUserRole(v: string): v is UserRole {
  return (ROLE_VALUES as readonly string[]).includes(v)
}

function parseUser(u: (typeof usersData)[number]): User {
  const status = u.status
  const role = u.role
  if (!isUserStatus(status)) throw new Error(`Invalid user status: ${status}`)
  if (!isUserRole(role)) throw new Error(`Invalid user role: ${role}`)
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    username: u.username,
    email: u.email,
    phoneNumber: u.phoneNumber,
    status,
    role,
    createdAt: new Date(u.createdAt),
    updatedAt: new Date(u.updatedAt),
  }
}

export const users: User[] = loadFixture(usersData, parseUser, 'users')
