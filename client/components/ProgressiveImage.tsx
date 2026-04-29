/**
 * Progressive Image Component
 *
 * Loads images in two stages:
 * 1. Low-quality placeholder (instant, blurry)
 * 2. Full-quality image (smooth transition)
 *
 * For Cloudinary images, automatically adds optimization parameters
 *
 * VU Size Reference: Uses VU-based sizes for responsive image optimization
 */

import { useState, useEffect } from 'react'
import { getPlaceholderImageUrl, getFullImageUrl, isCloudinaryUrl } from '@/utils/imageOptimization'

interface ProgressiveImageProps {
  src: string
  alt: string
  className?: string
  style?: React.CSSProperties
  onLoad?: () => void
  onError?: () => void
  placeholderBlur?: number // Blur amount for placeholder (0-20)
  children?: (imgProps: React.ImgHTMLAttributes<HTMLImageElement>) => React.ReactNode
}

/**
 * Progressive image component with smooth placeholder-to-full transition
 */
export function ProgressiveImage({
  src,
  alt,
  className,
  style,
  onLoad,
  onError,
  placeholderBlur = 10,
  children,
}: ProgressiveImageProps) {
  const [imageSrc, setImageSrc] = useState(() => {
    // Start with placeholder for Cloudinary URLs
    if (isCloudinaryUrl(src)) {
      return getPlaceholderImageUrl(src, placeholderBlur)
    }
    return src
  })
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    if (!src) {
      onError?.()
      return
    }

    // Reset state
    setIsLoaded(false)

    // For Cloudinary images, use progressive loading
    if (isCloudinaryUrl(src)) {
      const placeholder = getPlaceholderImageUrl(src)
      const fullImage = getFullImageUrl(src)

      // Load placeholder first (already set in state)
      const placeholderImg = new Image()
      placeholderImg.src = placeholder

      // Then load full image
      const fullImg = new Image()

      fullImg.onload = () => {
        setImageSrc(fullImage)
        setIsLoaded(true)
        onLoad?.()
      }

      fullImg.onerror = () => {
        onError?.()
      }

      // Small delay to let placeholder render first
      requestAnimationFrame(() => {
        setTimeout(() => {
          fullImg.src = fullImage
        }, 50)
      })
    } else {
      // For non-Cloudinary images, load directly
      const img = new Image()

      img.onload = () => {
        setIsLoaded(true)
        onLoad?.()
      }

      img.onerror = () => {
        onError?.()
      }

      img.src = src
    }
  }, [src, onLoad, onError])

  const imgStyle: React.CSSProperties = {
    ...style,
    // Smooth transition when image loads
    transition: isLoaded ? 'filter 0.3s ease-out' : undefined,
    // Blur placeholder until full image loads
    filter: isLoaded ? 'none' : `blur(${placeholderBlur}px)`,
    // Ensure smooth scaling
    imageRendering: 'auto',
  }

  if (children) {
    return <>{children({ src: imageSrc, alt, className, style: imgStyle })}</>
  }

  return <img src={imageSrc} alt={alt} className={className} style={imgStyle} />
}

/**
 * Hook for progressive image loading
 * Can be used in existing components
 *
 * @param src - Image URL
 * @param placeholderBlur - Blur amount for placeholder (0-20)
 * @param size - VU-based size preset for optimization
 */
export function useProgressiveImage(
  src: string,
  placeholderBlur: number = 10
) {
  const [imageSrc, setImageSrc] = useState(() => {
    if (isCloudinaryUrl(src)) {
      return getPlaceholderImageUrl(src, placeholderBlur)
    }
    return src
  })
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    if (!src || !isCloudinaryUrl(src)) {
      setImageSrc(src)
      setIsLoaded(true)
      return
    }

    const placeholder = getPlaceholderImageUrl(src, placeholderBlur)
    const fullImage = getFullImageUrl(src)

    // Load placeholder first
    setImageSrc(placeholder)
    setIsLoaded(false)

    // Then load full image
    const fullImg = new Image()
    fullImg.onload = () => {
      setImageSrc(fullImage)
      setIsLoaded(true)
    }
    fullImg.src = fullImage
  }, [src, placeholderBlur])

  return { imageSrc, isLoaded }
}
