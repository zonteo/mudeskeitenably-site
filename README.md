SITE MUDESK — DÉPLOIEMENT SUR NETLIFY
=====================================
Contenu du dossier :
  index.html                    -> le site
  netlify.toml                  -> configuration Netlify
  package.json                  -> dépendance @netlify/blobs (stockage)
  netlify/functions/data.mjs    -> la fonction « /api/data »

Étapes :
1. Mettre TOUT le dossier en ligne (pas seulement index.html), de préférence via GitHub
   (Netlify > Add new site > Import an existing project) ou avec la commande :
       npx netlify deploy --prod
2. Dans Netlify : Site configuration > Environment variables > Add a variable
       Nom : ADMIN_PASSWORD     Valeur : votre mot de passe administrateur
   Puis redéployer (Deploys > Trigger deploy).
3. Ouvrir le site à son adresse https://xxxx.netlify.app, se connecter en admin,
   puis ☰ Modifier le site > Test de connexion : Netlify doit afficher ✅.
