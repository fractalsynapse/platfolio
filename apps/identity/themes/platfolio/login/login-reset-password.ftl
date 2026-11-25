<#import "template.ftl" as layout>
<#assign resetByEmail = realm.loginWithEmailAllowed && !realm.duplicateEmailsAllowed>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError("username"); section>
    <#if section = "header">
        ${msg("emailForgotTitle")}
    <#elseif section = "form">
        <p class="ui-workspace-meta">${msg(resetByEmail?then("platfolioResetEmailHelp", "emailInstructionUsername"))}</p>
        <form id="kc-reset-password-form" class="${properties.kcFormClass!}" action="${url.loginAction}" method="post">
            <div class="${properties.kcFormGroupClass!}">
                <label for="username" class="${properties.kcLabelClass!}">${msg(resetByEmail?then("email", "username"))}</label>
                <input id="username" name="username" class="${properties.kcInputClass!}"
                    type="${resetByEmail?then('email', 'text')}" autocomplete="${resetByEmail?then('email', 'username')}"
                    <#if messagesPerField.existsError("username")>aria-invalid="true" aria-describedby="input-error-username"</#if>
                    dir="ltr" required autofocus>
                <#if messagesPerField.existsError("username")>
                    <p id="input-error-username" class="${properties.kcInputErrorMessageClass!}" role="alert">
                        ${kcSanitize(messagesPerField.get("username"))?no_esc}
                    </p>
                </#if>
            </div>
            <div class="${properties.kcFormButtonsClass!}">
                <button type="submit" class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!}">${msg("platfolioRequestResetLink")}</button>
                <a href="${url.loginUrl}">${msg("backToLogin")}</a>
            </div>
        </form>
    </#if>
</@layout.registrationLayout>
