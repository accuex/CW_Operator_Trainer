<?php

declare(strict_types=1);

use Cwot\Api\Controllers\ActivityController;
use Cwot\Api\Services\ActivityService;
use Cwot\Api\Config;
use Cwot\Api\Controllers\AuthController;
use Cwot\Api\Controllers\AuthMailController;
use Cwot\Api\Controllers\ContactController;
use Cwot\Api\Controllers\PasskeyController;
use Cwot\Api\Controllers\SyncController;
use Cwot\Api\Database;
use Cwot\Api\Http\JsonResponse;
use Cwot\Api\Middleware\CorsMiddleware;
use Cwot\Api\Middleware\JwtMiddleware;
use Cwot\Api\Services\JwtService;
use Cwot\Api\Services\MailService;
use Dotenv\Dotenv;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Factory\AppFactory;

require dirname(__DIR__) . '/vendor/autoload.php';

$root = dirname(__DIR__);
if (is_readable($root . '/.env')) {
    Dotenv::createImmutable($root)->safeLoad();
}

$config = Config::fromEnv();
$jwt = new JwtService($config);
$mail = new MailService($config);
$db = static fn () => Database::connection($config);
$auth = static fn () => new AuthController($db(), $jwt);
$authMail = static fn () => new AuthMailController($db(), $config, $mail, $jwt);
$sync = static fn () => new SyncController($db());
$passkey = static fn () => new PasskeyController($db(), $config, $jwt);
$contact = static fn () => new ContactController($config, $mail);
$jwtGuard = new JwtMiddleware($jwt);

$app = AppFactory::create();
$app->addBodyParsingMiddleware();
$app->add(new \Cwot\Api\Middleware\ActivityBodyLimitMiddleware());
$app->addRoutingMiddleware();
$app->add(new CorsMiddleware($config));

$errorMiddleware = $app->addErrorMiddleware($config->debug, true, true);
$errorMiddleware->setDefaultErrorHandler(
    function (Request $request, \Throwable $exception, bool $displayErrorDetails) use ($app, $config) {
        $response = $app->getResponseFactory()->createResponse();
        $message = $config->debug ? $exception->getMessage() : 'Internal server error';
        return JsonResponse::error($response, 'server_error', $message, 500);
    },
);

$app->get('/api/v1/health', function (Request $request, Response $response) {
    return JsonResponse::write($response, ['ok' => true, 'service' => 'cwot-api']);
});

$app->post('/api/v1/contact', function (Request $request, Response $response) use ($contact) {
    return $contact()->send($request, $response);
});

$app->post('/api/v1/auth/register', function (Request $request, Response $response) use ($auth) {
    return $auth()->register($request, $response);
});
$app->post('/api/v1/auth/login', function (Request $request, Response $response) use ($auth) {
    return $auth()->login($request, $response);
});
$app->post('/api/v1/auth/refresh', function (Request $request, Response $response) use ($auth) {
    return $auth()->refresh($request, $response);
});
$app->post('/api/v1/auth/password/forgot', function (Request $request, Response $response) use ($authMail) {
    return $authMail()->forgotPassword($request, $response);
});
$app->post('/api/v1/auth/password/reset', function (Request $request, Response $response) use ($authMail) {
    return $authMail()->resetPassword($request, $response);
});
$app->post('/api/v1/auth/email/confirm', function (Request $request, Response $response) use ($authMail) {
    return $authMail()->confirmEmailChange($request, $response);
});

$app->post('/api/v1/auth/passkey/login/options', function (Request $request, Response $response) use ($passkey) {
    return $passkey()->loginOptions($request, $response);
});
$app->post('/api/v1/auth/passkey/login/verify', function (Request $request, Response $response) use ($passkey) {
    return $passkey()->loginVerify($request, $response);
});

$app->group('/api/v1/me', function ($group) use ($passkey, $authMail) {
    $group->get('', function (Request $request, Response $response) use ($passkey) {
        return $passkey()->me($request, $response);
    });
    $group->get('/passkeys', function (Request $request, Response $response) use ($passkey) {
        return $passkey()->listPasskeys($request, $response);
    });
    $group->post('/passkeys/options', function (Request $request, Response $response) use ($passkey) {
        return $passkey()->registerOptions($request, $response);
    });
    $group->post('/passkeys/verify', function (Request $request, Response $response) use ($passkey) {
        return $passkey()->registerVerify($request, $response);
    });
    $group->delete('/passkeys/{id}', function (Request $request, Response $response, array $args) use ($passkey) {
        return $passkey()->deletePasskey($request, $response, $args);
    });
    $group->post('/email/change', function (Request $request, Response $response) use ($authMail) {
        return $authMail()->requestEmailChange($request, $response);
    });
})->add($jwtGuard);

$app->group('/api/v1/sync', function ($group) use ($sync) {
    $group->get('', function (Request $request, Response $response) use ($sync) {
        return $sync()->get($request, $response);
    });
    $group->put('/state', function (Request $request, Response $response) use ($sync) {
        return $sync()->putState($request, $response);
    });
    $group->post('/answers', function (Request $request, Response $response) use ($sync) {
        return $sync()->postAnswers($request, $response);
    });
    $group->post('/sessions', function (Request $request, Response $response) use ($sync) {
        return $sync()->postSessions($request, $response);
    });
})->add($jwtGuard);

$activity = static fn () => new ActivityController(new ActivityService($db(), json_decode(file_get_contents($root . '/data/activity-catalog.json'), true, 512, JSON_THROW_ON_ERROR)));
$app->get('/api/v1/activity', function (Request $request, Response $response) use ($activity) { return $activity()->handle($request, $response, 'feed'); });
$app->get('/api/v1/activity/settings', function (Request $request, Response $response) use ($activity) { return $activity()->handle($request, $response, 'consent'); });
$app->put('/api/v1/activity/profile', function (Request $request, Response $response) use ($activity) { return $activity()->handle($request, $response, 'profile'); });
$app->put('/api/v1/activity/settings', function (Request $request, Response $response) use ($activity) { return $activity()->handle($request, $response, 'settings'); });
$app->post('/api/v1/activity/events', function (Request $request, Response $response) use ($activity) { return $activity()->handle($request, $response, 'events'); });

$app->run();
