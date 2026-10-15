import type { ComponentProps } from 'react'

import { fireEvent, render, screen } from '@testing-library/react'
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
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/api/media?path=%2Fdbdata%2Fpic.png')

    await user.click(screen.getByRole('button', { name: 'Retry image' }))
    expect(screen.getByAltText('pic')).toBeInTheDocument()
    expect(screen.queryByTestId('image-error')).not.toBeInTheDocument()
  })
})
