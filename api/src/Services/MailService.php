<?php

declare(strict_types=1);

namespace Cwot\Api\Services;

use Cwot\Api\Config;
use PHPMailer\PHPMailer\Exception as MailException;
use PHPMailer\PHPMailer\PHPMailer;
use RuntimeException;

final class MailService
{
    public function __construct(private readonly Config $config)
    {
    }

    public function send(string $to, string $subject, string $textBody, ?string $htmlBody = null, ?string $replyTo = null): void
    {
        $mail = new PHPMailer(true);
        try {
            $mail->CharSet = 'UTF-8';
            $mail->setFrom($this->config->mailFrom, $this->config->mailFromName);
            $mail->addAddress($to);
            if ($replyTo !== null) {
                $mail->addReplyTo($replyTo);
            }
            $mail->Subject = $subject;
            $mail->Body = $htmlBody ?? $textBody;
            $mail->AltBody = $textBody;
            if ($htmlBody !== null) {
                $mail->isHTML(true);
            }

            $mail->Timeout = 12;

            if ($this->config->smtpHost === '') {
                throw new RuntimeException(
                    'SMTP_HOST is not set. Local sendmail is unavailable; configure SMTP in api/.env',
                );
            }

            $mail->isSMTP();
            $mail->Host = $this->config->smtpHost;
            $mail->Port = $this->config->smtpPort;
            $mail->SMTPAuth = $this->config->smtpUser !== '';
            if ($mail->SMTPAuth) {
                $mail->Username = $this->config->smtpUser;
                $mail->Password = $this->config->smtpPass;
            }
            $enc = $this->config->smtpEncryption;
            if ($enc === 'tls' || $enc === 'ssl') {
                $mail->SMTPSecure = $enc;
            } else {
                $mail->SMTPSecure = false;
                $mail->SMTPAutoTLS = false;
            }

            $mail->send();
        } catch (MailException $error) {
            throw new RuntimeException('Failed to send mail: ' . $error->getMessage(), 0, $error);
        }
    }

    public function sendPasswordReset(string $to, string $resetUrl): void
    {
        $subject = '【CW Operator Trainer】パスワード再設定';
        $text = "パスワード再設定のリクエストを受け付けました。\n\n"
            . "次のリンクから新しいパスワードを設定してください（1時間有効）:\n"
            . $resetUrl . "\n\n"
            . "心当たりがない場合はこのメールを無視してください。\n";
        $html = '<p>パスワード再設定のリクエストを受け付けました。</p>'
            . '<p><a href="' . htmlspecialchars($resetUrl, ENT_QUOTES | ENT_HTML5, 'UTF-8') . '">パスワードを再設定する</a></p>'
            . '<p>リンクの有効期限は1時間です。心当たりがない場合はこのメールを無視してください。</p>';
        $this->send($to, $subject, $text, $html);
    }

    public function sendEmailChangeConfirm(string $to, string $confirmUrl, string $currentEmail): void
    {
        $subject = '【CW Operator Trainer】メールアドレス変更の確認';
        $text = "メールアドレス変更の確認です。\n\n"
            . "現在の登録: {$currentEmail}\n"
            . "変更先: {$to}\n\n"
            . "次のリンクで変更を確定してください（1時間有効）:\n"
            . $confirmUrl . "\n\n"
            . "心当たりがない場合はこのメールを無視してください。\n";
        $html = '<p>メールアドレス変更の確認です。</p>'
            . '<p>現在の登録: ' . htmlspecialchars($currentEmail, ENT_QUOTES | ENT_HTML5, 'UTF-8') . '<br>'
            . '変更先: ' . htmlspecialchars($to, ENT_QUOTES | ENT_HTML5, 'UTF-8') . '</p>'
            . '<p><a href="' . htmlspecialchars($confirmUrl, ENT_QUOTES | ENT_HTML5, 'UTF-8') . '">メールアドレス変更を確定する</a></p>'
            . '<p>リンクの有効期限は1時間です。心当たりがない場合はこのメールを無視してください。</p>';
        $this->send($to, $subject, $text, $html);
    }
}
