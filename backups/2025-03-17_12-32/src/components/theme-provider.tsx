"use client"

import * as React from "react"

type Theme = "dark" | "light" | "system"

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
  attribute?: string
  enableSystem?: boolean
  disableTransitionOnChange?: boolean
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  attribute = "data-theme",
  enableSystem = true,
  disableTransitionOnChange = false,
}: ThemeProviderProps) {
  const [theme, setTheme] = React.useState<Theme>(defaultTheme)

  React.useEffect(() => {
    const root = window.document.documentElement
    root.setAttribute(attribute, theme)
  }, [theme, attribute])

  const value = React.useMemo(
    () => ({
      theme,
      setTheme: (newTheme: Theme) => {
        setTheme(newTheme)
      },
    }),
    [theme]
  )

  return (
    <ThemeContext.Provider value={value}>
      {disableTransitionOnChange && (
        <style jsx global>{`
          * {
            transition: none !important;
          }
        `}</style>
      )}
      {children}
    </ThemeContext.Provider>
  )
}

interface ThemeContextProps {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextProps>({
  theme: "system",
  setTheme: () => null,
})

export const useTheme = () => React.useContext(ThemeContext) 