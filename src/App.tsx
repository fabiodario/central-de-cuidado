import { Routes, Route } from 'react-router'
import { HeartHandshake } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { ProvedorDeDialogos } from '@/components/Dialogos'
import Home from './pages/Home'
import Login from './pages/Login'
import NovaSenha from './pages/NovaSenha'

export default function App() {
  const { session, loading, recovering } = useAuth()

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#f7f5f1] text-[#081b2c]">
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] bg-[#081b2c] text-[#6fadde] shadow-[0_18px_45px_rgba(8,27,44,.18)]">
            <HeartHandshake className="h-6 w-6 animate-pulse" />
          </span>
          <p className="mt-4 text-xs font-extrabold uppercase tracking-[0.16em] text-slate-400">
            Preparando ambiente seguro
          </p>
        </div>
      </main>
    )
  }

  // Veio pelo link de "esqueci a senha": antes de qualquer outra tela, a
  // senha nova. A sessao temporaria do link nao deve abrir o sistema.
  if (recovering) return <NovaSenha />

  if (!session) return <Login />

  return (
    <ProvedorDeDialogos>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </ProvedorDeDialogos>
  )
}
