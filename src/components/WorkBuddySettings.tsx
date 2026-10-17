/**
 * WorkBuddy channel settings.
 *
 * WorkBuddy does not take an API key: it uses a polling OAuth login. The flow
 * is three steps, and the UI has to show all of them because step two waits
 * on something the user is doing in another window:
 *
 *   1. start   → we get an auth URL, the user opens it
 *   2. approve → the user signs in, our poll returns
 *   3. done    → the credential is stored server-side
 *
 * The credential never reaches the browser: the poll endpoint stores it and
 * answers with the account nickname only.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, ExternalLink, Loader2, LogOut, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { trpc } from '@/providers/trpc'

type Phase = 'idle' | 'starting' | 'waiting' | 'success' | 'error'

interface WorkBuddySettingsProps {
  /** Current provider from the server, used to show the right panel. */
  provider: string
  /** Current regional build. */
  product: string
  /** Called after a successful login so the parent can refresh settings. */
  onChanged: () => void
}

export function WorkBuddySettings({
  provider,
  product: initialProduct,
  onChanged,
}: WorkBuddySettingsProps) {
  const [selectedProduct, setSelectedProduct] = useState(initialProduct || 'workbuddy')
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [authUrl, setAuthUrl] = useState('')
  const [nickname, setNickname] = useState('')
  const pollAbort = useRef(false)

  const productsQuery = trpc.aiSettings.workbuddyProducts.useQuery()
  const startMutation = trpc.aiSettings.workbuddyStart.useMutation()
  const pollMutation = trpc.aiSettings.workbuddyPoll.useMutation()
  const signOutMutation = trpc.aiSettings.workbuddySignOut.useMutation()

  const signedIn = provider === 'workbuddy'

  useEffect(() => {
    if (initialProduct) setSelectedProduct(initialProduct)
  }, [initialProduct])

  useEffect(() => {
    return () => {
      // Leaving the page must stop the poll, otherwise a slow approval would
      // resolve against an unmounted component.
      pollAbort.current = true
    };
  }, [])

  const handleSignIn = useCallback(async () => {
    pollAbort.current = false
    setPhase('starting')
    setMessage('')
    setNickname('')
    try {
      const started = await startMutation.mutateAsync({ product: selectedProduct })
      setAuthUrl(started.authUrl)
      setPhase('waiting')
      // Open the approval page. The poll below is what actually completes the
      // login, so a blocked popup is not fatal: the URL is shown as a link.
      window.open(started.authUrl, '_blank', 'noopener,noreferrer')

      const result = await pollMutation.mutateAsync({
        state: started.state,
        product: selectedProduct,
      })
      if (pollAbort.current) return
      setPhase('success')
      setMessage('已登录' + (result.nickname ? '：' + result.nickname : ''))
      setNickname(result.nickname ?? '')
      onChanged()
    } catch (err) {
      if (pollAbort.current) return
      setPhase('error')
      setMessage(err instanceof Error ? err.message : '登录失败')
    }
  }, [selectedProduct, startMutation, pollMutation, onChanged])

  const handleSignOut = useCallback(async () => {
    try {
      await signOutMutation.mutateAsync()
      setPhase('idle')
      setMessage('已退出 WorkBuddy')
      setAuthUrl('')
      onChanged()
    } catch (err) {
      setPhase('error')
      setMessage(err instanceof Error ? err.message : '退出失败')
    }
  }, [signOutMutation, onChanged])

  const products = productsQuery.data ?? []
  const models = products.find((p) => p.id === selectedProduct)?.models ?? []

  return (
    <motion.div variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}>
      <Card
        className="overflow-hidden rounded-2xl border-0 shadow-none"
        style={{ backgroundColor: 'var(--bg-surface)' }}
      >
        <CardHeader className="px-4 pt-4 pb-0">
          <CardTitle
            className="text-base font-medium"
            style={{
              fontFamily: "'DM Sans', sans-serif",
              color: 'var(--text-primary)',
            }}
          >
            WorkBuddy 渠道
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-4">
          {signedIn && (
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--text-primary)' }}
            >
              <Check size={16} style={{ color: 'var(--success)' }} />
              <span>已连接{nickname ? '：' + nickname : ''}</span>
            </div>
          )}

          {/* Regional build: the endpoint decides the model pool, so this
              choice is not cosmetic. */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              区域版本
            </Label>
            <div className="flex gap-2">
              {products.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProduct(p.id)}
                  disabled={signedIn}
                  className="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60"
                  style={{
                    backgroundColor:
                      selectedProduct === p.id ? 'var(--accent)' : 'var(--bg-elevated)',
                    color: selectedProduct === p.id ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  {p.displayName}
                </button>
              ))}
            </div>
          </div>

          {models.length > 0 && (
            <p className="text-xs px-1" style={{ color: 'var(--text-tertiary)' }}>
              可用模型：{models.slice(0, 4).join('、')}
              {models.length > 4 ? ' 等 ' + models.length + ' 个' : ''}
            </p>
          )}

          {!signedIn ? (
            <Button
              variant="outline"
              className="w-full gap-2 rounded-lg border-0"
              style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
              onClick={handleSignIn}
              disabled={phase === 'starting' || phase === 'waiting'}
            >
              {(phase === 'starting' || phase === 'waiting') && (
                <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />
              )}
              {phase === 'success' && <Check size={16} style={{ color: 'var(--success)' }} />}
              {phase === 'error' && <X size={16} style={{ color: 'var(--error)' }} />}
              {phase === 'idle' || phase === 'success' ? <ExternalLink size={16} /> : null}
              <span>
                {phase === 'starting' && '正在获取登录地址...'}
                {phase === 'waiting' && '等待浏览器授权...'}
                {(phase === 'idle' || phase === 'success' || phase === 'error') &&
                  '登录 WorkBuddy'}
              </span>
            </Button>
          ) : (
            <Button
              variant="outline"
              className="w-full gap-2 rounded-lg border-0"
              style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
              onClick={handleSignOut}
            >
              <LogOut size={16} />
              <span>退出 WorkBuddy</span>
            </Button>
          )}

          {phase === 'waiting' && authUrl && (
            <p className="text-xs px-1" style={{ color: 'var(--text-tertiary)' }}>
              没有自动打开？
              <a
                href={authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: 'var(--accent)' }}
              >
                点此打开登录页
              </a>
            </p>
          )}

          {message && (
            <p
              className="text-xs px-1"
              style={{ color: phase === 'error' ? 'var(--error)' : 'var(--success)' }}
            >
              {message}
            </p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
