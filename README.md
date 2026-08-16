# NLab Homepage

Стартовая страница с каталогом сервисов и проектов.

## Что умеет

- показывает каталог сервисов и отдельный экран проектов;
- ищет по названиям и описаниям;
- сортирует разделы и карточки по настройкам;
- переключает светлую, тёмную и системную тему;
- подхватывает изменения YAML без перезапуска контейнера;
- работает на телефонах и компьютерах.

## Быстрый запуск

Нужны Node.js 24 и npm.

### 1. Создайте конфигурацию

Приложение читает файлы из каталога `config`:

- `global.yaml` — заголовок и сортировка;
- `catalog.yaml` — основной каталог;
- `projects.yaml` — проекты, необязательный файл.

`config/global.yaml`:

```yaml
header:
  title: My Lab
sorting:
  catalog:
    categories: false
    cards: false
  projects:
    categories: false
    cards: false
```

`config/catalog.yaml`:

```yaml
groups:
  - name: Основное
    services:
      - name: GitHub
        href: https://github.com
        description: Репозитории и задачи
        icon: github.svg
      - name: Мониторинг
        href: https://status.example.com
        description: Состояние сервисов
        icon: mdi-monitor-dashboard
```

`config/projects.yaml`:

```yaml
projects:
  - name: Сайт
    services:
      - name: Продакшен
        href: https://example.com
        description: Публичная версия
        icon: mdi-web
```

Допустимые значения `icon` перечислены в [`src/domain/directory-types.ts`](src/domain/directory-types.ts).

### 2. Запустите приложение

```bash
npm ci
npm run validate:config -- config/global.yaml config/catalog.yaml config/projects.yaml
PROJECTS_CONFIG_PATH=config/projects.yaml npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000).

Если проекты не нужны, удалите `config/projects.yaml`. Проверка и приложение считают этот файл необязательным.

## Docker

```yaml
services:
  homepage:
    image: ghcr.io/webzaytsev/nlab-homepage:latest
    restart: unless-stopped
    environment:
      PROJECTS_CONFIG_PATH: /app/config/projects.yaml
    ports:
      - "8080:8080"
    volumes:
      - ./config:/app/config:ro
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
```

```bash
docker compose up -d
```

Для повторяемого развёртывания используйте тег `sha-<полный SHA>` вместо `latest`. Если пакет GHCR закрыт, сначала выполните `docker login ghcr.io`.

Пути к файлам можно переопределить переменными:

```text
GLOBAL_CONFIG_PATH=/app/config/global.yaml
CATALOG_CONFIG_PATH=/app/config/catalog.yaml
PROJECTS_CONFIG_PATH=/app/config/projects.yaml
```

`global.yaml` и `catalog.yaml` обязательны. Без них или с невалидными данными каталог отвечает ошибкой: встроенной демонстрационной конфигурации нет. Некорректное обновление уже открытого каталога не заменяет последнюю рабочую версию.

## Команды

| Команда | Что делает |
| --- | --- |
| `npm run dev` | запускает Next.js в режиме разработки |
| `npm run lint` | проверяет исходный код через Oxlint |
| `npm run build` | собирает рабочую версию |
| `npm run validate:config -- <файлы>` | проверяет YAML и схему данных |
| `npm run check:config-format -- <файлы>` | проверяет каноническое форматирование YAML |

## Служебные маршруты

- `/healthz` — проверка доступности процесса;
- `/global.yaml` — текущая общая конфигурация;
- `/config.yaml` — текущий каталог в YAML или полный снимок данных при `Accept: application/json`;
- `/projects.yaml` — текущие проекты.

## Сборка образа

GitHub Actions проверяет сборку Docker-образа для каждого push и pull request. Push в `main` публикует два тега:

```text
ghcr.io/webzaytsev/nlab-homepage:latest
ghcr.io/webzaytsev/nlab-homepage:sha-<полный SHA>
```

Рабочий образ запускается от пользователя `node`, содержит встроенную проверку состояния и не включает пользовательские YAML-файлы.

## Стек

Next.js 16, React 19, TypeScript 6, Zod, YAML и Oxlint.

## Лицензия

[MIT](LICENSE) © Nikita Zaitsev
