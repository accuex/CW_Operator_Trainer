<?php

declare(strict_types=1);

namespace Cwot\Api\Controllers;

use Cwot\Api\Config;
use Cwot\Api\Http\JsonResponse;
use Cwot\Api\Http\RequestBody;
use Cwot\Api\Services\MailService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Throwable;

/** Contact form → one mail to the site admin. No copy goes back to the sender. */
final class ContactController
{
    public const CATEGORIES = [
        'question' => '使い方の質問',
        'bug' => '不具合の報告',
        'request' => '機能の要望',
        'account' => 'アカウント・同期',
        'other' => 'その他',
    ];

    private const NAME_MAX = 100;
    private const MESSAGE_MIN = 10;
    private const MESSAGE_MAX = 4000;
    /** Per-IP sends allowed inside the window. */
    private const RATE_LIMIT = 5;
    private const RATE_WINDOW_SECONDS = 3600;

    public function __construct(
        private readonly Config $config,
        private readonly MailService $mail,
    ) {
    }

    public function send(Request $request, Response $response): Response
    {
        $body = RequestBody::json($request);

        // Honeypot: real visitors never see this field. Pretend success so bots move on.
        if (trim((string) ($body['website'] ?? '')) !== '') {
            return JsonResponse::write($response, ['ok' => true]);
        }

        $name = self::singleLine((string) ($body['name'] ?? ''));
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $category = (string) ($body['category'] ?? '');
        $message = trim(str_replace("\r\n", "\n", (string) ($body['message'] ?? '')));

        $errors = [];
        if ($name === '' || mb_strlen($name) > self::NAME_MAX) {
            $errors['name'] = 'お名前を' . self::NAME_MAX . '文字以内で入力してください';
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = 'メールアドレスの形式を確認してください';
        }
        if (!array_key_exists($category, self::CATEGORIES)) {
            $errors['category'] = 'お問い合わせの種類を選んでください';
        }
        $length = mb_strlen($message);
        if ($length < self::MESSAGE_MIN || $length > self::MESSAGE_MAX) {
            $errors['message'] = '内容は' . self::MESSAGE_MIN . '〜' . self::MESSAGE_MAX . '文字で入力してください';
        }
        if ($errors !== []) {
            return JsonResponse::error($response, 'validation_error', 'Invalid contact form', 422, ['fields' => $errors]);
        }

        $ip = self::clientIp($request);
        if (!$this->allowSend($ip)) {
            return JsonResponse::error($response, 'rate_limited', 'Too many messages. Please try again later.', 429);
        }

        if ($this->config->contactTo === '') {
            return JsonResponse::error($response, 'not_configured', 'Contact recipient is not configured', 503);
        }

        $label = self::CATEGORIES[$category];
        $subject = '【CWOT Academy】お問い合わせ（' . $label . '）' . $name . ' 様';
        $sentAt = (new \DateTimeImmutable('now', new \DateTimeZone('Asia/Tokyo')))->format('Y-m-d H:i:s');
        $agent = self::singleLine($request->getHeaderLine('User-Agent'));
        $text = "お問い合わせフォームから送信がありました。\n"
            . "このメールに返信すると、送信者へ返信できます。\n\n"
            . "種類: {$label}\n"
            . "お名前: {$name}\n"
            . "メール: {$email}\n"
            . "送信日時: {$sentAt} (JST)\n\n"
            . "――――――――――――――――\n"
            . $message . "\n"
            . "――――――――――――――――\n\n"
            . "IP: {$ip}\n"
            . "UA: {$agent}\n";

        try {
            $this->mail->send($this->config->contactTo, $subject, $text, null, $email);
        } catch (Throwable $error) {
            if ($this->config->debug) {
                throw $error;
            }
            return JsonResponse::error($response, 'mail_failed', 'Could not send the message', 502);
        }

        return JsonResponse::write($response, ['ok' => true]);
    }

    /** Strips control characters (incl. newlines) so header-bound values stay on one line. */
    private static function singleLine(string $value): string
    {
        return trim((string) preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $value));
    }

    private static function clientIp(Request $request): string
    {
        $server = $request->getServerParams();
        return (string) ($server['REMOTE_ADDR'] ?? 'unknown');
    }

    /** Small file-backed sliding window; good enough for a single-host contact form. */
    private function allowSend(string $ip): bool
    {
        $path = sys_get_temp_dir() . '/cwot-contact-' . hash('sha256', $ip) . '.json';
        $now = time();
        $handle = @fopen($path, 'c+');
        if ($handle === false) {
            return true;
        }
        try {
            flock($handle, LOCK_EX);
            $stamps = json_decode((string) stream_get_contents($handle), true);
            $stamps = array_values(array_filter(
                is_array($stamps) ? $stamps : [],
                fn ($stamp) => is_int($stamp) && $stamp > $now - self::RATE_WINDOW_SECONDS,
            ));
            if (count($stamps) >= self::RATE_LIMIT) {
                return false;
            }
            $stamps[] = $now;
            ftruncate($handle, 0);
            rewind($handle);
            fwrite($handle, (string) json_encode($stamps));
            return true;
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }
}
