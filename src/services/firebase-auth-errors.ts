export function firebaseSignInError(error: { code?: string; message?: string }, fallback = 'Не удалось войти. Повторите попытку.') {
  switch (error.code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Окно входа Google закрыто до завершения. Нажмите «Sign in with Google» и завершите выбор аккаунта.';
    case 'auth/popup-blocked':
      return 'Браузер заблокировал окно Google. Разрешите всплывающие окна для этого сайта и повторите вход.';
    case 'auth/unauthorized-domain':
      return 'Этот адрес не разрешён в Firebase Authentication. Добавьте домен страницы в Authentication → Settings → Authorized domains существующего проекта Firebase.';
    case 'auth/network-request-failed':
      return 'Не удалось связаться с Firebase для входа. Проверьте подключение к интернету и повторите попытку.';
    case 'auth/operation-not-allowed':
      return 'Этот способ входа отключён в Firebase. Проверьте включённые способы входа в существующем проекте.';
    default:
      return error.message || fallback;
  }
}
