import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../services/api';
import LoginPage from '../components/login/LoginPage';

const Login = () => {
  const { login } = useAuth();
  const navigate = useNavigate();

  const authenticate = async ({ username, password }) => {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error || 'Usuário ou senha incorretos.');
    }
    if (!data?.user || !data?.token) {
      throw new Error('Resposta inválida do servidor.');
    }

    return data;
  };

  const completeLogin = (data) => {
    login(data.user, data.token);
    toast.success(data.user.name ? `Bem-vindo, ${data.user.name}!` : 'Login realizado.', { duration: 3000 });
    navigate(data.user.role === 'AGENT' ? '/agent' : '/monitor');
  };

  return (
    <LoginPage
      onSubmit={authenticate}
      onSuccess={completeLogin}
      brandName="Onion Flows"
      title="Acesse sua conta"
      subtitle="Use suas credenciais da equipe Onion Flows."
      build="5.4.5"
      region="Goioerê"
      transitionDuration={3600}
    />
  );
};

export default Login;
