# Umami

[Umami](https://umami.is/) est un outil de statistiques web simple et
respectueux de la vie privée, libre (MIT), auto-hébergé ou sur Umami Cloud.
Cette intégration amène les chiffres de vos sites Umami dans Gladys : chaque
site devient un appareil avec ses visiteurs en ce moment et ses visiteurs,
visites, pages vues, taux de rebond et page la plus vue du jour. Des scènes
peuvent réagir à un pic de visiteurs, au premier visiteur de la journée ou à un
site qui ne reçoit plus aucune visite (script de suivi cassé), un widget du
tableau de bord résume la journée d'un coup d'œil, et une action de scène met
les chiffres d'un site dans un message.

Testée contre un vrai Umami 3.4.0 et 2.19.0 auto-hébergé (Docker, PostgreSQL) ;
pas encore sur Umami Cloud : vos retours sont les bienvenus dans
[les issues](https://github.com/guim31/gladys-umami/issues).

## Ce qu'il vous faut

- Gladys Assistant 5.1.0 ou plus récent.
- Un Umami : sur [Umami Cloud](https://cloud.umami.is/), ou votre propre
  serveur (Umami 2 ou 3), joignable depuis la machine Gladys.
- Pour se connecter, au choix :
  - Umami Cloud : une **clé d'API** ;
  - votre serveur, à partir d'Umami 3.4 : une **clé d'API** (elle commence par
    `umami_`) ;
  - votre serveur, toute version : un **nom d'utilisateur et son mot de
    passe**. Un utilisateur au rôle « lecture seule » suffit, et le compte ne
    doit pas avoir la double authentification.

À chaque rafraîchissement, l'intégration envoie deux requêtes par site
(visiteurs en ce moment, chiffres du jour), plus la page la plus vue toutes les
5 minutes, les visites des dernières heures toutes les 15 minutes et la liste
des sites toutes les 10 minutes. Sur Umami Cloud (50 requêtes par 15 secondes), l'intégration se freine elle-même à 40 requêtes par 15 secondes : avec beaucoup de sites, choisissez un intervalle plus long pour que chaque lecture reste à l'heure. Gladys accepte 300 états par minute : avec l'intervalle de 30 secondes, ajoutez au plus 25 sites à Gladys.

## Mise en route

### 1. Créer une clé d'API, ou un utilisateur

- Umami Cloud, ou votre serveur à partir d'Umami 3.4 : dans Umami, ouvrez
  **Settings → API keys**, créez une clé et copiez-la (elle n'est montrée
  qu'une fois).
- Sinon : dans **Settings → Users**, créez un utilisateur au rôle **View
  only** et donnez-lui accès aux sites (ou utilisez votre propre compte).

### 2. Configurer l'intégration

Dans Gladys, ouvrez **Intégrations → Umami → Configuration** :

- **Adresse d'Umami** : vide pour Umami Cloud, ou l'adresse de votre serveur
  (par exemple `http://192.168.1.10:3000`). Une adresse copiée depuis le
  navigateur est comprise.
- **Clé d'API**, ou **Nom d'utilisateur** et **Mot de passe** : voir
  ci-dessus. Avec une clé d'API, l'identifiant et le mot de passe ne servent
  pas.
- **Intervalle de rafraîchissement** : de 30 secondes à 5 minutes (1 minute
  par défaut).
- **Pic de visiteurs à partir de** : les visiteurs simultanés qui déclenchent
  « Pic de visiteurs » (10 par défaut).
- **Aucune visite depuis (heures)** : les heures sans aucune visite qui
  déclenchent « Aucune visite depuis un moment » (24 par défaut).
- **Langue des noms** : langue des noms des fonctionnalités et des résultats de
  scène (français par défaut).

Enregistrez, puis cliquez sur **Tester la connexion** : le résultat donne le
nombre de sites, les visiteurs du jour et ceux du moment.

### 3. Ajouter les sites

Ouvrez l'onglet **Découverte** : chaque site est proposé avec son nom. Ajoutez
ceux que vous voulez voir dans Gladys. Les déclencheurs de scène et le widget
fonctionnent pour tous les sites, ajoutés ou non.

## Les appareils

Chaque site devient un appareil avec :

- **Visiteurs en ce moment** : les visiteurs des 5 dernières minutes, comme la
  page « Realtime » d'Umami.
- **Visiteurs aujourd'hui** : visiteurs uniques depuis minuit.
- **Visites aujourd'hui** : visites (sessions) depuis minuit.
- **Pages vues aujourd'hui** : pages vues depuis minuit.
- **Taux de rebond aujourd'hui** : la part des visites qui n'ont vu qu'une
  page, en pourcentage.
- **Page la plus vue aujourd'hui** : son chemin, par exemple `/posts/hello` ;
  « - » avant la première page vue de la journée.

« Aujourd'hui » commence à minuit dans le fuseau horaire de Gladys : les
chiffres du jour repartent de 0 à minuit. Une valeur qui ne change pas est
renvoyée toutes les 12 heures, pour que Gladys la garde récente.

## Tableau de bord

Le widget **Umami aujourd'hui** affiche quatre tuiles (visiteurs en ce moment,
visiteurs, visites et pages vues du jour), additionnées sur les sites
affichés, puis une ligne par site avec ses visiteurs du jour et du moment, le
plus fréquenté d'abord. Avec un seul site, c'est la page la plus vue du jour
qui s'affiche. Dans les réglages du widget, choisissez des sites pour
n'afficher qu'eux (appareils ajoutés à Gladys). Le bouton **Actualiser** relit
Umami.

## Scènes

### Déclencheurs

- **Pic de visiteurs** : les visiteurs en ce moment d'un site atteignent le
  seuil de la configuration. Une fois par pic, et 30 minutes au moins entre deux annonces pour un site : un pic encore en cours à la fin de la pause est annoncé à ce moment-là.
  Variables : nom du site, domaine, visiteurs en ce moment, seuil.
- **Premier visiteur de la journée** : un site reçoit son premier visiteur
  depuis minuit. Variables : nom du site, domaine, visiteurs aujourd'hui. Si l'intégration était arrêtée, le premier visiteur est annoncé à la première lecture après son redémarrage.
- **Aucune visite depuis un moment** : un site qui avait des visites n'en reçoit
  plus pendant les heures de la configuration : le script de suivi est
  peut-être cassé, ou le site en panne. Une fois, jusqu'au retour d'une visite.
  Variables : nom du site, domaine, heures sans visite.

Chaque déclencheur peut être limité à certains sites (vide : tous). Ce dont
les déclencheurs se souviennent est gardé dans le volume `/data` : un
redémarrage de Gladys ou de l'intégration n'annonce pas deux fois un pic ou un
premier visiteur. Rien n'est annoncé à la première lecture d'un site : un pic
ou un silence déjà en cours est seulement noté.

### Actions

- **Lire les chiffres d'un site** : donne le nom (`name`), les visiteurs en ce
  moment (`active`), les `visitors`, `visits`, `pageviews` et `bounce_rate` du
  jour, la page la plus vue (`top_page`) et une phrase toute prête
  (`sentence`), par exemple « Blog : 132 visiteur(s) et 410 page(s) vue(s)
  aujourd'hui, 4 en ce moment, page la plus vue /posts/hello. ».

### Idées de scènes

- Quand **Pic de visiteurs** se déclenche pour votre boutique, envoyez un
  message Telegram « Affluence sur {{website}} : {{visitors}} visiteurs en ce
  moment ».
- Quand **Aucune visite depuis un moment** se déclenche, envoyez une
  notification « Aucune visite sur {{website}} depuis {{hours}} h : vérifiez
  le script de suivi ».
- Chaque soir à 21 h, **Lire les chiffres d'un site** et envoyer la phrase par
  message.
- Avec la fonctionnalité **Visiteurs en ce moment** en condition de scène,
  allumez une lampe en vert tant que quelqu'un est sur le site.

## Dépannage

- **« Umami Cloud : collez votre clé d'API »** : l'adresse est vide, donc
  l'intégration utilise Umami Cloud. Indiquez l'adresse de votre serveur si
  vous hébergez Umami vous-même.
- **« clé d'API, nom d'utilisateur ou mot de passe refusé »** : recopiez la
  clé, ou vérifiez l'identifiant et le mot de passe en vous connectant à Umami
  avec eux.
- **« ce compte a la double authentification »** : créez une clé d'API (Umami
  3.4+), ou un utilisateur dédié en lecture seule sans double authentification.
- **« aucun Umami à cette adresse »** : vérifiez l'adresse et le port (3000 par
  défaut). Derrière un proxy inverse avec un sous-chemin (`BASE_PATH`),
  incluez-le.
- **« l'adresse redirige »** : saisissez directement l'adresse en `https://`.
- **« trop de requêtes »** : choisissez un intervalle plus long.
- Un site manque : l'utilisateur ou la clé doit y avoir accès (sites d'une
  équipe compris). La liste est relue toutes les 10 minutes, ou avec
  **Rechercher** dans l'onglet Découverte.
- Les logs de l'intégration (**Intégrations → Umami**) en disent plus ; rien
  n'y est écrit pendant un cycle de lecture normal.

## Limites

- Lecture seule : l'intégration ne modifie rien dans Umami.
- Les chiffres sont ceux d'Umami au moment de la lecture, avec l'intervalle de
  rafraîchissement comme délai. « Visiteurs en ce moment » est la fenêtre de 5
  minutes d'Umami.
- Un seul compte Umami (Cloud ou serveur) par intégration.
- Les seuils de « Pic de visiteurs » et « Aucune visite depuis un moment » sont
  les mêmes pour tous les sites.
- Umami 1 n'est pas pris en charge (son API est différente). Les sites d'une équipe sont lus à partir d'Umami 3 ; sur Umami 2, seulement ceux du compte ou des équipes qu'il possède ou gère.
- Pas encore testée sur Umami Cloud, et sans lien avec Umami Software.
