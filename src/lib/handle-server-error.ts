import { toast } from 'sonner'

function responseTitle(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const response = (error as { response?: { data?: { title?: unknown } } })
    .response
  const title = response?.data?.title
  return typeof title === 'string' ? title : undefined
}

export function handleServerError(error: unknown) {
  let errMsg = 'Something went wrong!'

  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    Number(error.status) === 204
  ) {
    errMsg = 'Content not found.'
  }

  const title = responseTitle(error)
  if (title) {
    errMsg = title
  }

  toast.error(errMsg)
}
