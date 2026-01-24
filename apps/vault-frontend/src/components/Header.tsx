import { Link } from '@tanstack/react-router'
import { Vault } from 'lucide-react'

export default function Header() {
  return (
    <header className="p-4 flex items-center justify-between bg-gray-900 text-white shadow-lg border-b border-gray-800">
      <div className="flex items-center gap-6">
        <Link to="/" className="flex items-center gap-2">
          <Vault size={28} className="text-cyan-400" />
          <span className="text-xl font-bold">Prediction Vault</span>
        </Link>
      </div>

      <div className="flex items-center gap-4">
        <appkit-button />
      </div>
    </header>
  )
}
