import { useEffect } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import {
  isStaleAssetError,
  reloadForStaleAsset,
} from '@/lib/stale-asset-reload'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type GeneralErrorProps = React.HTMLAttributes<HTMLDivElement> & {
  error?: unknown
  minimal?: boolean
}

export function GeneralError({
  className,
  error,
  minimal = false,
}: GeneralErrorProps) {
  const navigate = useNavigate()
  const { history } = useRouter()
  const staleAssetError = isStaleAssetError(error)

  useEffect(() => {
    if (staleAssetError) {
      reloadForStaleAsset()
    }
  }, [staleAssetError])

  return (
    <div className={cn('h-svh w-full', className)}>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        {!minimal && (
          <h1 className='text-[7rem] leading-tight font-bold'>500</h1>
        )}
        <span className='font-medium'>
          {staleAssetError
            ? 'Dashboard shell updated'
            : 'Oops! Something went wrong.'}
        </span>
        <p className='text-center text-muted-foreground'>
          {staleAssetError ? (
            <>
              Reloading the latest dashboard assets. <br /> If this message
              remains, refresh the page.
            </>
          ) : (
            <>
              We apologize for the inconvenience. <br /> Please try again later.
            </>
          )}
        </p>
        {!minimal && (
          <div className='mt-6 flex gap-4'>
            <Button variant='outline' onClick={() => history.go(-1)}>
              Go Back
            </Button>
            <Button onClick={() => navigate({ to: '/' })}>Back to Home</Button>
          </div>
        )}
      </div>
    </div>
  )
}
