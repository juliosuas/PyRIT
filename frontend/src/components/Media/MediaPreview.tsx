import { useCallback, useEffect, useRef, useState } from 'react'

import { Button, Spinner, Text } from '@fluentui/react-components'

import { basenameFromValue } from '@/utils/media'

import { useMediaPreviewStyles } from './MediaPreview.styles'

export interface MediaPreviewProps {
  readonly type: 'image' | 'audio' | 'video'
  readonly src: string
  readonly alt?: string
  readonly className?: string
  readonly hiddenClassName?: string
  readonly containerClassName?: string
  readonly spinnerClassName?: string
  /** Mount the media element only after the user asks. Chat leaves this off. */
  readonly lazy?: boolean
  /** Offer retry and download after a failed load. Chat leaves this off. */
  readonly recovery?: boolean
}

function stopPlayback(media: HTMLMediaElement | null): void {
  if (!media || media.paused) return
  media.pause()
}

function failureMessage(type: MediaPreviewProps['type'], recovery: boolean): string {
  const label = type === 'image' ? 'Image' : type === 'audio' ? 'Audio' : 'Video'
  if (!recovery) return `${label} failed to load`
  return `${label} failed to load. The file may be missing, or the link may be expired or inaccessible.`
}

function RecoveryActions({
  type,
  src,
  onRetry,
}: {
  type: MediaPreviewProps['type']
  src: string
  onRetry: () => void
}) {
  const styles = useMediaPreviewStyles()
  const label = type === 'image' ? 'image' : type === 'audio' ? 'audio' : 'video'
  return (
    <div className={styles.recovery}>
      <Text size={200} italic data-testid={`${type}-error`}>{failureMessage(type, true)}</Text>
      <div className={styles.actions}>
        <Button className={styles.button} appearance="secondary" onClick={onRetry}>
          {`Retry ${label}`}
        </Button>
        <a className={styles.download} href={src} download={basenameFromValue(src, label)} rel="noopener noreferrer">
          Download
        </a>
      </div>
    </div>
  )
}

/**
 * Shared image, audio, and video preview used by chat and dataset details.
 * Playback is never automatic. Lazy callers mount the element only on request
 * and pause it when the preview is hidden or leaves the page.
 */
export default function MediaPreview({
  type,
  src,
  alt = '',
  className,
  hiddenClassName,
  containerClassName,
  spinnerClassName,
  lazy = false,
  recovery = false,
}: MediaPreviewProps) {
  const styles = useMediaPreviewStyles()
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const setMediaRef = useCallback((node: HTMLMediaElement | null) => {
    mediaRef.current = node
  }, [])
  const [open, setOpen] = useState(!lazy)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const onLoad = useCallback(() => setLoaded(true), [])
  const onError = useCallback(() => {
    setError(true)
    setLoaded(true)
  }, [])

  useEffect(() => {
    const media = mediaRef.current
    return () => {
      stopPlayback(media)
    }
  }, [open, attempt, error])

  const retry = (): void => {
    setError(false)
    setLoaded(false)
    setAttempt((current) => current + 1)
  }

  const hide = (): void => {
    stopPlayback(mediaRef.current)
    setOpen(false)
    setError(false)
    setLoaded(false)
  }

  if (!open) {
    return (
      <Button className={styles.button} appearance="secondary" onClick={() => setOpen(true)}>
        {`Show ${type} preview`}
      </Button>
    )
  }

  const hideButton = lazy ? (
    <Button className={styles.button} appearance="secondary" onClick={hide}>
      {`Hide ${type} preview`}
    </Button>
  ) : null

  if (type === 'image') {
    return (
      <div className={containerClassName ?? styles.imageContainer}>
        {hideButton}
        {!loaded && !error && <Spinner size="small" className={spinnerClassName ?? styles.spinner} />}
        {error
          ? (recovery
            ? <RecoveryActions type={type} src={src} onRetry={retry} />
            : <Text size={200} italic data-testid="image-error">{failureMessage(type, false)}</Text>)
          : <img
              key={attempt}
              src={src}
              alt={alt}
              className={loaded ? (className ?? styles.image) : (hiddenClassName ?? styles.imageHidden)}
              loading={lazy ? 'lazy' : undefined}
              onLoad={onLoad}
              onError={onError}
            />
        }
      </div>
    )
  }

  if (error) {
    return (
      <>
        {hideButton}
        {recovery
          ? <RecoveryActions type={type} src={src} onRetry={retry} />
          : <Text size={200} italic data-testid={`${type}-error`}>{failureMessage(type, false)}</Text>}
      </>
    )
  }

  const mediaClassName = className ?? (type === 'video' ? styles.video : styles.audio)
  const preload = lazy ? 'none' : undefined

  return (
    <>
      {hideButton}
      {type === 'video' ? (
        <video
          key={attempt}
          ref={setMediaRef}
          src={src}
          controls
          autoPlay={false}
          preload={preload}
          className={mediaClassName}
          onError={onError}
          data-testid="video-player"
        />
      ) : (
        <audio
          key={attempt}
          ref={setMediaRef}
          src={src}
          controls
          autoPlay={false}
          preload={preload}
          className={mediaClassName}
          onError={onError}
          data-testid="audio-player"
        />
      )}
    </>
  )
}
