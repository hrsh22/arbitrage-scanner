import { Link } from '@tanstack/react-router'
import { Vault, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export default function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-black/50 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 transition-transform group-hover:scale-105">
            <Vault className="h-5 w-5 text-white" />
            <div className="absolute inset-0 rounded-lg bg-cyan-500/20 blur-md" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">
            Poly<span className="text-cyan-400">Vault</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          <Link
            to="/"
            className="text-sm font-medium text-gray-300 hover:text-white transition-colors"
          >
            Vaults
          </Link>
          <div className="h-4 w-px bg-white/10" />
          <appkit-button />
        </nav>

        <button
          className="md:hidden p-2 text-gray-400 hover:text-white"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-white/10 bg-black/90 backdrop-blur-xl"
          >
            <div className="flex flex-col p-4 space-y-4">
              <Link
                to="/"
                className="text-sm font-medium text-gray-300 hover:text-white"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Vaults
              </Link>
              <div className="pt-2 border-t border-white/10">
                <appkit-button />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
