<script setup>
import { ref } from "vue"
import api from "../api"
import { useRouter } from "vue-router"
import logoTesla from "../assets/logo-tesla.png"

const router = useRouter()

const email = ref("")
const password = ref("")
const error = ref("")
const loading = ref(false)

const login = async () => {
  error.value = ""
  loading.value = true

  try {
    const res = await api.login(email.value, password.value)

    localStorage.setItem("session", JSON.stringify(res.data.session))
    router.push("/dashboard")
  } catch (err) {
    error.value = "Credenciales incorrectas"
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <header class="login-header">
      <div class="login-header-text">
        <h1 class="title">SISTEMA GESTION TESLA</h1>
        <p class="subtitle">Montajes eléctricos</p>
      </div>
      <div class="login-header-logo">
        <!-- Poné tu logo en: frontend/src/assets/logo-tesla.png -->
        <img :src="logoTesla" alt="Logo Tesla" />
      </div>
    </header>

    <main class="login-main">
      <section class="login-card">
        <h2>Iniciar sesión</h2>

        <form @submit.prevent="login" class="login-form">
          <label class="field">
            <span>Email</span>
            <input
              v-model="email"
              type="email"
              placeholder="usuario@empresa.com"
              required
            />
          </label>

          <label class="field">
            <span>Contraseña</span>
            <input
              v-model="password"
              type="password"
              placeholder="••••••••"
              required
            />
          </label>

          <button type="submit" :disabled="loading" class="btn-primary">
            {{ loading ? "Ingresando..." : "Ingresar" }}
          </button>

          <p v-if="error" class="error-text">
            {{ error }}
          </p>
        </form>
      </section>
    </main>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: radial-gradient(circle at top, #1f2937 0%, #020617 55%, #000 100%);
  color: #e5e7eb;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.login-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.5rem 3rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.3);
  background: linear-gradient(to right, rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.5));
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 25px rgba(15, 23, 42, 0.8);
}

.login-header-text {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.title {
  font-size: 1.4rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  margin: 0;
  color: #f9fafb;
}

.subtitle {
  margin: 0;
  font-size: 0.9rem;
  color: #9ca3af;
}

.login-header-logo img {
  height: 48px;
  object-fit: contain;
  filter: drop-shadow(0 0 8px rgba(148, 163, 184, 0.4));
}

.login-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem 3rem;
}

.login-card {
  width: 100%;
  max-width: 420px;
  background: radial-gradient(circle at top left, rgba(30, 64, 175, 0.35), rgba(15, 23, 42, 0.96));
  border-radius: 1rem;
  padding: 2rem 2.25rem 2.4rem;
  box-shadow:
    0 22px 45px rgba(0, 0, 0, 0.7),
    0 0 0 1px rgba(148, 163, 184, 0.25);
  border: 1px solid rgba(75, 85, 99, 0.8);
}

.login-card h2 {
  margin: 0 0 1.5rem;
  font-size: 1.25rem;
  font-weight: 600;
  color: #e5e7eb;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.9rem;
}

.field span {
  color: #d1d5db;
}

input {
  border-radius: 0.6rem;
  border: 1px solid rgba(75, 85, 99, 0.9);
  padding: 0.65rem 0.85rem;
  background: rgba(15, 23, 42, 0.9);
  color: #f9fafb;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}

input::placeholder {
  color: #6b7280;
}

input:focus {
  border-color: #38bdf8;
  box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.6);
  background: rgba(15, 23, 42, 0.95);
}

.btn-primary {
  margin-top: 0.5rem;
  border: none;
  border-radius: 999px;
  padding: 0.7rem 1rem;
  background: linear-gradient(135deg, #38bdf8, #2563eb);
  color: #f9fafb;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.12s ease, opacity 0.1s ease;
  box-shadow:
    0 12px 24px rgba(37, 99, 235, 0.4),
    0 0 0 1px rgba(191, 219, 254, 0.25);
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    0 18px 34px rgba(37, 99, 235, 0.55),
    0 0 0 1px rgba(191, 219, 254, 0.3);
}

.btn-primary:active:not(:disabled) {
  transform: translateY(0);
  box-shadow:
    0 10px 20px rgba(37, 99, 235, 0.45),
    0 0 0 1px rgba(191, 219, 254, 0.25);
}

.btn-primary:disabled {
  opacity: 0.7;
  cursor: default;
}

.error-text {
  margin: 0.75rem 0 0;
  font-size: 0.85rem;
  color: #fca5a5;
}

@media (max-width: 640px) {
  .login-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
  }

  .login-main {
    padding: 1.5rem 1rem 2rem;
  }

  .login-card {
    padding: 1.75rem 1.5rem 2rem;
  }
}
</style>