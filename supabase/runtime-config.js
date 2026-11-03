/* Public browser configuration. The publishable key is designed for frontend use;
   row-level security and the private Storage bucket enforce data access. */
window.EC_SUPABASE_CONFIG = Object.freeze({
  url: 'https://muktpljlzzavcvhqdxco.supabase.co',
  publishableKey: 'sb_publishable_r8ETvsY_vJ0MbwXma8xgog_Gs7jtgyz',
  storageBucket: 'edgecontrol-prints',
  /* Código público da conta: identifica a conta em todos os aparelhos. */
  accountCode: 'EC-7K4M-9Q2X',
  /* Aparelho do site: um usuário que já é MEMBRO desta conta. Qualquer
     navegador que abra o painel entra com ele e passa a enviar/receber as
     alterações (operações, ajustes e prints) sem digitar nada.
     É de propósito público: a conta inteira já aparece no painel. Para cortar
     o acesso de todos os navegadores de uma vez, apague a linha desse usuário
     em supabase/ec_members — o painel continua funcionando só localmente. */
  deviceLogin: Object.freeze({
    email: 'site@edgecontrol.app',
    password: 'ecsite_9f4c2b71d85a3e60'
  })
});
