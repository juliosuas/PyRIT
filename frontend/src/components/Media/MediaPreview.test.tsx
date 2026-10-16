import { useState, type ComponentProps } from 'react'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'

import MediaPreview from './MediaPreview'

function renderPreview(props: Partial<ComponentProps<typeof MediaPreview>> & Pick<ComponentProps<typeof MediaPreview>, 'type' | 'src'>) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MediaPreview {...props} />
    </FluentProvider>,
  )
}

describe('MediaPreview', () => {
  it('should render chat image, audio, and video immediately and never autoplay', () => {
    renderPreview({ type: 'image', src: 'data:image/png;base64,AAAA', alt: 'chart' })
    const image = screen.getByAltText('chart')
    expect(image).toBeInTheDocument()
    expect(image).not.toHaveAttribute('loading')
    expect(screen.queryByRole('button', { name: /preview/i })).not.toBeInTheDocument()

    renderPreview({ type: 'audio', src: 'https://example.test/talk.wav' })
    const audio = screen.getByTestId('audio-player')
    expect(audio).toHaveAttribute('src', 'https://example.test/talk.wav')
    expect(audio).toHaveAttribute('controls')
    expect(audio).not.toHaveAttribute('autoplay')
    expect(audio).not.toHaveAttribute('preload')

    renderPreview({ type: 'video', src: 'https://example.test/clip.mp4' })
    const video = screen.getByTestId('video-player')
    expect(video).not.toHaveAttribute('autoplay')
    expect((video as HTMLVideoElement).paused).toBe(true)
  })

  it('should keep the chat failure text', () => {
    renderPreview({ type: 'video', src: 'https://example.test/broken.mp4' })
    fireEvent.error(screen.getByTestId('video-player'))
    expect(screen.getByTestId('video-error')).toHaveTextContent('Video failed to load')
    expect(screen.queryByRole('button', { name: 'Retry video' })).not.toBeInTheDocument()

    renderPreview({ type: 'audio', src: 'https://example.test/broken.wav' })
    fireEvent.error(screen.getByTestId('audio-player'))
    expect(screen.getByTestId('audio-error')).toHaveTextContent('Audio failed to load')

    renderPreview({ type: 'image', src: 'https://example.test/broken.png', alt: 'broken' })
    fireEvent.error(screen.getByAltText('broken'))
    expect(screen.getByTestId('image-error')).toHaveTextContent('Image failed to load')
  })

  it('should load lazily, stay paused, and stop when the preview is dismissed', async () => {
    const user = userEvent.setup()
    renderPreview({ type: 'video', src: 'https://example.test/clip.mp4', lazy: true })
    expect(screen.queryByTestId('video-player')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show video preview' }))
    const video = screen.getByTestId('video-player') as HTMLVideoElement
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false })
    const pause = jest.spyOn(video, 'pause').mockImplementation(() => {})
    expect(video).toHaveAttribute('preload', 'none')
    expect(video.autoplay).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Hide video preview' }))
    expect(pause).toHaveBeenCalled()
    expect(screen.queryByTestId('video-player')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show video preview' })).toBeInTheDocument()
  })

  it('should pause playback when the preview leaves the page', () => {
    const { unmount } = renderPreview({ type: 'audio', src: 'https://example.test/talk.wav' })
    const audio = screen.getByTestId('audio-player') as HTMLAudioElement
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => false })
    const pause = jest.spyOn(audio, 'pause').mockImplementation(() => {})
    unmount()
    expect(pause).toHaveBeenCalled()
  })

  it('should retry and offer download after a failed on-demand load', async () => {
    const user = userEvent.setup()
    renderPreview({
      type: 'image',
      src: '/api/media?path=%2Fdbdata%2Fpic.png',
      alt: 'pic',
      lazy: true,
      recovery: true,
    })
    expect(screen.queryByAltText('pic')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show image preview' }))
    fireEvent.error(screen.getByAltText('pic'))
    expect(screen.getByTestId('image-error')).toHaveTextContent(
      'Image failed to load. The file may be missing, or the link may be expired or inaccessible.',
    )
    const download = screen.getByRole('link', { name: 'Download' })
    expect(download).toHaveAttribute('href', '/api/media?path=%2Fdbdata%2Fpic.png')
    expect(download).toHaveAttribute('download', 'pic.png')
    expect(download).not.toHaveAttribute('target')

    await user.click(screen.getByRole('button', { name: 'Retry image' }))
    expect(screen.getByAltText('pic')).toBeInTheDocument()
    expect(screen.queryByTestId('image-error')).not.toBeInTheDocument()
  })

  it('should open a cross-origin file in a new tab instead of leaving the page', async () => {
    const user = userEvent.setup()
    const signed = 'https://account.blob.core.windows.net/container/clip.mp4?sig=expired'
    renderPreview({ type: 'video', src: signed, lazy: true, recovery: true })
    await user.click(screen.getByRole('button', { name: 'Show video preview' }))
    fireEvent.error(screen.getByTestId('video-player'))

    const link = screen.getByRole('link', { name: 'Open in new tab' })
    expect(link).toHaveAttribute('href', signed)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).not.toHaveAttribute('download')
  })

  it('should retry with a newly signed url and refresh again when the preview is reopened', async () => {
    const user = userEvent.setup()
    const expired = 'https://account.blob.core.windows.net/container/pic.png?sig=expired'
    const fresh = 'https://account.blob.core.windows.net/container/pic.png?sig=fresh'
    const refresh = jest.fn(async () => fresh)

    function Harness() {
      const [src, setSrc] = useState(expired)
      return (
        <FluentProvider theme={webLightTheme}>
          <MediaPreview
            type="image"
            src={src}
            alt="pic"
            lazy
            recovery
            onRetry={async () => {
              const next = await refresh()
              await Promise.resolve()
              setSrc(next)
              return next
            }}
          />
        </FluentProvider>
      )
    }

    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Show image preview' }))
    expect(screen.getByAltText('pic')).toHaveAttribute('src', expired)
    expect(refresh).not.toHaveBeenCalled()

    fireEvent.error(screen.getByAltText('pic'))
    await user.click(screen.getByRole('button', { name: 'Retry image' }))
    await waitFor(() => expect(screen.getByAltText('pic')).toHaveAttribute('src', fresh))
    expect(screen.queryByTestId('image-error')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Hide image preview' }))
    await user.click(screen.getByRole('button', { name: 'Show image preview' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    expect(screen.getByAltText('pic')).toHaveAttribute('src', fresh)
  })

  it('should stay on the failure when refreshing the signed url fails', async () => {
    const user = userEvent.setup()
    let settled = false
    renderPreview({
      type: 'image',
      src: 'https://account.blob.core.windows.net/container/pic.png?sig=expired',
      alt: 'pic',
      lazy: true,
      recovery: true,
      onRetry: async () => {
        settled = true
        throw new Error('unavailable')
      },
    })
    await user.click(screen.getByRole('button', { name: 'Show image preview' }))
    fireEvent.error(screen.getByAltText('pic'))
    await user.click(screen.getByRole('button', { name: 'Retry image' }))
    await waitFor(() => expect(settled).toBe(true))
    expect(screen.getByTestId('image-error')).toBeInTheDocument()
    expect(screen.queryByAltText('pic')).not.toBeInTheDocument()
  })
})
