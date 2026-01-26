import { createFileRoute, Link } from '@tanstack/react-router'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { Vault, ArrowRight, Shield, Zap, Activity, Wallet } from 'lucide-react'
import { api, type Vault as VaultType } from '../lib/api'
import { motion, type Variants } from 'framer-motion'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'

export const Route = createFileRoute('/')({ component: Dashboard })

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: 'easeOut' },
  },
}

function Dashboard() {
  const { address, isConnected } = useAccount()

  const {
    data: vaultsResponse,
    isLoading: vaultsLoading,
    error: vaultsError,
  } = useQuery({
    queryKey: ['vaults', 'public'],
    queryFn: () => api.vaults.list(),
    refetchInterval: 30000,
  })

  const vaults = vaultsResponse?.data ?? []

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={containerVariants}
          className="flex flex-col items-center text-center mb-24"
        >
          <motion.div
            variants={itemVariants}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-1.5 text-sm font-medium text-cyan-300"
          >
            <Zap className="h-4 w-4 fill-cyan-500/50" />
            <span>Automated Yield Generation</span>
          </motion.div>

          <motion.h1
            variants={itemVariants}
            className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6"
          >
            Predict.{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
              Earn.
            </span>{' '}
            Repeat.
          </motion.h1>

          <motion.p
            variants={itemVariants}
            className="text-xl text-gray-400 max-w-2xl mb-10"
          >
            Institutional-grade automated strategies for Polymarket prediction
            markets. Deposit USDC.e and let our bots generate yield for you.
          </motion.p>

          <motion.div
            variants={itemVariants}
            className="flex flex-col sm:flex-row gap-4"
          >
            <Button
              size="lg"
              className="bg-cyan-600 hover:bg-cyan-500 text-white px-8 h-12 text-lg rounded-full shadow-[0_0_20px_rgba(8,145,178,0.4)] transition-all hover:scale-105"
              asChild
            >
              <a href="#vaults">
                Start Earning <ArrowRight className="ml-2 h-5 w-5" />
              </a>
            </Button>
          </motion.div>
        </motion.div>

        <div id="vaults" className="mb-24 scroll-mt-24">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl font-bold text-white">Active Vaults</h2>
            {isConnected && (
              <span className="text-sm text-gray-400">
                Connected:{' '}
                <span className="text-cyan-400 font-mono">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </span>
              </span>
            )}
          </div>

          {vaultsError && (
            <div className="bg-red-900/20 border border-red-900/50 rounded-xl p-6 text-center text-red-200">
              Unable to load vaults. Please try again later.
            </div>
          )}

          {vaultsLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Skeleton className="h-[280px] w-full bg-white/5 rounded-xl" />
              <Skeleton className="h-[280px] w-full bg-white/5 rounded-xl" />
            </div>
          )}

          {!vaultsLoading && vaults.length === 0 && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center backdrop-blur-sm">
              <Vault className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">
                No Vaults Active
              </h3>
              <p className="text-gray-400">
                Our strategies are currently paused or full. Check back soon.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {vaults.map((vault, i) => (
              <VaultCard
                key={vault.id}
                vault={vault}
                index={i}
                isConnected={isConnected}
                address={address}
              />
            ))}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="border-t border-white/10 pt-24"
        >
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">How It Works</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              Our automated system handles the complexity of prediction market
              trading while you earn the yields.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <FeatureCard
              icon={<Wallet className="w-8 h-8 text-cyan-400" />}
              title="1. Deposit USDC.e"
              description="Connect your wallet and deposit USDC.e into one of our strategy vaults. You receive share tokens representing your stake."
            />
            <FeatureCard
              icon={<Activity className="w-8 h-8 text-blue-400" />}
              title="2. Automated Trading"
              description="Our algorithmic bots scan Polymarket 24/7 for high-probability opportunities and execute trades instantly."
            />
            <FeatureCard
              icon={<Shield className="w-8 h-8 text-green-400" />}
              title="3. Secure Profits"
              description="Withdraw your initial capital plus accumulated profits anytime. Claims are processed after a safety unlock period."
            />
          </div>
        </motion.div>
      </div>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="p-6 rounded-2xl bg-gradient-to-br from-white/5 to-transparent border border-white/10 hover:border-cyan-500/30 transition-colors group">
      <div className="mb-4 p-3 bg-white/5 rounded-xl w-fit group-hover:bg-cyan-500/10 group-hover:scale-110 transition-all duration-300">
        {icon}
      </div>
      <h3 className="text-xl font-semibold text-white mb-3">{title}</h3>
      <p className="text-gray-400 leading-relaxed">{description}</p>
    </div>
  )
}

function VaultCard({
  vault,
  index,
  isConnected,
  address,
}: {
  vault: VaultType
  index: number
  isConnected: boolean
  address: string | undefined
}) {
  const { data: statusResponse, isLoading: statusLoading } = useQuery({
    queryKey: ['vault', vault.slug, 'status'],
    queryFn: () => api.vaults.getStatus(vault.slug),
    refetchInterval: 30000,
  })

  const { data: userResponse } = useQuery({
    queryKey: ['user', vault.slug, address],
    queryFn: () => api.users.get(vault.slug, address!),
    enabled: isConnected && !!address,
    refetchInterval: 30000,
  })

  const status = statusResponse?.data
  const user = userResponse?.data

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.1 }}
    >
      <Card className="overflow-hidden bg-slate-900/80 border-white/10 hover:border-cyan-500/50 transition-all duration-300 group hover:shadow-[0_0_30px_rgba(8,145,178,0.15)]">
        <div className="p-6">
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-cyan-500/10 rounded-lg group-hover:bg-cyan-500/20 transition-colors">
                <Vault className="w-6 h-6 text-cyan-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white group-hover:text-cyan-300 transition-colors">
                  {vault.name}
                </h3>
                <p className="text-xs text-cyan-400/80 uppercase tracking-wider font-semibold mt-0.5">
                  Algorithm: PPH-Fast
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="text-xs font-medium text-green-400">Active</span>
            </div>
          </div>

          <p className="text-gray-400 text-sm mb-6 min-h-[40px] line-clamp-2">
            {vault.description ||
              'High-frequency arbitrage strategy targeting mispriced prediction markets on Polymarket.'}
          </p>

          <div className="grid grid-cols-2 gap-4 mb-6 p-4 bg-white/5 rounded-xl border border-white/5">
            <div>
              <p className="text-gray-500 text-xs uppercase mb-1">
                Total Assets
              </p>
              {statusLoading ? (
                <Skeleton className="h-6 w-20 bg-white/10" />
              ) : (
                <p className="text-xl font-mono font-semibold text-white">
                  {formatUsd(status?.totalAssetsUsdc || 0)}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-gray-500 text-xs uppercase mb-1">
                Share Price (NAV)
              </p>
              {statusLoading ? (
                <Skeleton className="h-6 w-20 bg-white/10 ml-auto" />
              ) : (
                <p className="text-xl font-mono font-semibold text-green-400">
                  ${parseFloat(status?.navPerShare || '1').toFixed(4)}
                </p>
              )}
            </div>
          </div>

          {isConnected && user && parseFloat(user.position.shares) > 0 && (
            <div className="mb-6 px-4 py-3 bg-cyan-900/20 border border-cyan-500/20 rounded-lg flex justify-between items-center">
              <span className="text-cyan-200 text-sm">Your Position</span>
              <span className="text-white font-mono font-medium">
                {formatUsd(user.position.valueUsdc)}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Button
              className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-semibold"
              asChild
            >
              <Link to="/vault/$slug/deposit" params={{ slug: vault.slug }}>
                Deposit
              </Link>
            </Button>
            <Button
              variant="outline"
              className="w-full border-white/20 text-white hover:bg-white/10 hover:text-white"
              asChild
            >
              <Link to="/vault/$slug/withdraw" params={{ slug: vault.slug }}>
                Withdraw
              </Link>
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}

function formatUsd(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num)
}
