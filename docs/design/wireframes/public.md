# Public site and sign-in

The public shell carries navigation to the available content and sign-in. The callback is an empty technical transition. [Wireframe index](README.md)

## Landing

`/` · MVP

**Desktop**

```text
+------------------------------------------------------------------------+
| Desktop screen                                                         |
| +--------------------------------------------------------------------+ |
| | Public navigation                                                  | |
| | Home | Guides | Sign in                                            | |
| | Templates when enabled                                             | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Landing                                                            | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Product summary                                                    | |
| | Managed hosting for supported platforms                            | |
| | Infrastructure and data ownership                                  | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Start links                                                        | |
| | Sign in | Hosting guide                                            | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Hosting steps                                                      | |
| | Connect repository and workspace                                   | |
| | Review install PR | Verify deploy                                  | |
| | Operate or export                                                  | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| Mobile screen                      |
| +--------------------------------+ |
| | Public navigation              | |
| | Home | Guides | Sign in        | |
| | Templates when enabled         | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Landing                        | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Product summary                | |
| | Managed hosting for supported  | |
| | platforms                      | |
| | Infrastructure and data        | |
| | ownership                      | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Start links                    | |
| | Sign in | Hosting guide        | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Hosting steps                  | |
| | Connect repository and         | |
| | workspace                      | |
| | Review install PR | Verify     | |
| | deploy                         | |
| | Operate or export              | |
| +--------------------------------+ |
+------------------------------------+
```

Sign in opens [Sign-in](#sign-in). Hosting guide opens [Guides](#guides). The public page can be served as static content.

## Template catalog

`/templates` · Later

**Desktop**

```text
+------------------------------------------------------------------------+
| Desktop screen                                                         |
| +--------------------------------------------------------------------+ |
| | Public navigation                                                  | |
| | Home | Guides | Sign in                                            | |
| | Templates when enabled                                             | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Templates                                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Search name, publisher, or capability                              | |
| | Category | Operating mode | Sort | Clear filters                   | |
| | Result count                                                       | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Template card grid                                                 | |
| | Optional cover | Category | Type | Name                             | |
| | Published by | Updated                                             | |
| | Summary | Capabilities                                            | |
| | Public access | Environments                                       | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| Mobile screen                      |
| +--------------------------------+ |
| | Public navigation              | |
| | Home | Guides | Sign in        | |
| | Templates when enabled         | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Templates                      | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Search templates               | |
| | Category | Operating mode      | |
| | Sort | Clear filters           | |
| | Result count                   | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Template cards (stacked)       | |
| | Optional cover | Type | Name    | |
| | Published by | Updated          | |
| | Summary | Capabilities        | |
| | Access | Environments          | |
| | Last updated | View template  | |
| +--------------------------------+ |
+------------------------------------+
```

Each card links to [Template detail](#template-detail). The MVP picker uses the same search, filters, and cards inside [Create instance](team.md#create-instance), with an action to select a template. An empty result keeps the filters in place and gives the user a way to clear them.

## Template detail

`/templates/:template` · Later

**Desktop**

```text
+------------------------------------------------------------------------+
| Desktop screen                                                         |
| +--------------------------------------------------------------------+ |
| | Public navigation                                                  | |
| | Home | Guides | Sign in                                            | |
| | Templates when enabled                                             | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Template detail                                                    | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Template summary                                                   | |
| | Name | Service shape | Public endpoints                            | |
| | Publisher | Last updated                                           | |
| | Included materials                                                 | |
| | Source repository and ref                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Split                                                              | |
| | +------------------------------+  +------------------------------+ | |
| | | Stack                        |  | Context rail                 | | |
| | | +--------------------------+ |  | +--------------------------+ | | |
| | | | Start links              | |  | | Prerequisites            | | | |
| | | | Start setup with         | |  | | Provider resources |     | | | |
| | | | template selected        | |  | | Required inputs          | | | |
| | | +--------------------------+ |  | | Source and template      | | | |
| | | +--------------------------+ |  | | guide links              | | | |
| | | | Capabilities             | |  | +--------------------------+ | | |
| | | | Provides | Requires      | |  +------------------------------+ | |
| | | +--------------------------+ |                                   | |
| | +------------------------------+                                   | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| Mobile screen                      |
| +--------------------------------+ |
| | Public navigation              | |
| | Home | Guides | Sign in        | |
| | Templates when enabled         | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Template detail                | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Template summary               | |
| | Name | Service shape | Public  | |
| | endpoints                      | |
| | Publisher | Last updated       | |
| | Included materials            | |
| | Optional management           | |
| | Source repository and ref      | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Start links                    | |
| | Start setup with template      | |
| | selected                       | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Capabilities                   | |
| | Provides | Requires            | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Open prerequisites             | |
| | Opens details sheet            | |
| +--------------------------------+ |
| When opened                        |
| +--------------------------------+ |
| | Details sheet                  | |
| | +----------------------------+ | |
| | | Prerequisites              | | |
| | | Provider resources |       | | |
| | | Required inputs            | | |
| | | Source and template guide  | | |
| | | links                      | | |
| | +----------------------------+ | |
| +--------------------------------+ |
+------------------------------------+
```

Start setup goes through sign-in and team selection as needed. Create instance records the resolved source commit.

## Guides

`/docs` · MVP

**Desktop**

```text
+------------------------------------------------------------------------+
| Desktop screen                                                         |
| +--------------------------------------------------------------------+ |
| | Public navigation                                                  | |
| | Home | Guides | Sign in                                            | |
| | Templates when enabled                                             | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Guides                                                             | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Guide list                                                         | |
| | Connect | Operate | Export and restore                             | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Local development link                                             | |
| | Run the same manifest with Compose                                 | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| Mobile screen                      |
| +--------------------------------+ |
| | Public navigation              | |
| | Home | Guides | Sign in        | |
| | Templates when enabled         | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Guides                         | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Guide list                     | |
| | Connect | Operate | Export and | |
| | restore                        | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Local development link         | |
| | Run the same manifest with     | |
| | Compose                        | |
| +--------------------------------+ |
+------------------------------------+
```

Connect and Operate explain the managed workflow. Export and restore points to Lifecycle and the [Compose and restore guide](#compose-and-restore-guide).

## Compose and restore guide

`/docs/self-host` · MVP

**Desktop**

```text
+------------------------------------------------------------------------+
| Desktop screen                                                         |
| +--------------------------------------------------------------------+ |
| | Public navigation                                                  | |
| | Home | Guides | Sign in                                            | |
| | Templates when enabled                                             | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Compose and restore guide                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Split                                                              | |
| | +------------------------------+  +------------------------------+ | |
| | | Stack                        |  | Context rail                 | | |
| | | +--------------------------+ |  | +--------------------------+ | | |
| | | | Guide steps              | |  | | Guide contents           | | | |
| | | | Resolve prerequisites |  | |  | | Run locally | Restore |  | | | |
| | | | Run Compose              | |  | | Verify                   | | | |
| | | | Restore tenant data |    | |  | | Export prerequisites     | | | |
| | | | Check services           | |  | +--------------------------+ | | |
| | | +--------------------------+ |  +------------------------------+ | |
| | | +--------------------------+ |                                   | |
| | | | Reference block          | |                                   | |
| | | | Manifest source |        | |                                   | |
| | | | Compose instructions     | |                                   | |
| | | | Restore and verify       | |                                   | |
| | | | instructions             | |                                   | |
| | | +--------------------------+ |                                   | |
| | +------------------------------+                                   | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| Mobile screen                      |
| +--------------------------------+ |
| | Public navigation              | |
| | Home | Guides | Sign in        | |
| | Templates when enabled         | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Compose and restore guide      | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Guide steps                    | |
| | Resolve prerequisites | Run    | |
| | Compose                        | |
| | Restore tenant data | Check    | |
| | services                       | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Reference block                | |
| | Manifest source | Compose      | |
| | instructions                   | |
| | Restore and verify             | |
| | instructions                   | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Open guide contents            | |
| | Opens details sheet            | |
| +--------------------------------+ |
| When opened                        |
| +--------------------------------+ |
| | Details sheet                  | |
| | +----------------------------+ | |
| | | Guide contents             | | |
| | | Run locally | Restore |    | | |
| | | Verify                     | | |
| | | Export prerequisites       | | |
| | +----------------------------+ | |
| +--------------------------------+ |
+------------------------------------+
```

Cover both local development from the same manifest and standalone restore from the downloaded export.

## API reference

`/docs/api` · Later

**Desktop**

```text
+------------------------------------------------------------------------+
| Desktop screen                                                         |
| +--------------------------------------------------------------------+ |
| | Public navigation                                                  | |
| | Home | Guides | Sign in                                            | |
| | Templates when enabled                                             | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | API reference                                                      | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Split                                                              | |
| | +------------------------------+  +------------------------------+ | |
| | | Stack                        |  | Context rail                 | | |
| | | +--------------------------+ |  | +--------------------------+ | | |
| | | | Operation detail         | |  | | Operation index          | | | |
| | | | Method and path | Auth   | |  | | Operations grouped by    | | | |
| | | | and scope                | |  | | resource                 | | | |
| | | | Request | Response |     | |  | | Jump to operation        | | | |
| | | | Errors                   | |  | +--------------------------+ | | |
| | | +--------------------------+ |  +------------------------------+ | |
| | | +--------------------------+ |                                   | |
| | | | Source link              | |                                   | |
| | | | OpenAPI contract         | |                                   | |
| | | +--------------------------+ |                                   | |
| | +------------------------------+                                   | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| Mobile screen                      |
| +--------------------------------+ |
| | Public navigation              | |
| | Home | Guides | Sign in        | |
| | Templates when enabled         | |
| +--------------------------------+ |
| +--------------------------------+ |
| | API reference                  | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Operation detail               | |
| | Method and path | Auth and     | |
| | scope                          | |
| | Request | Response | Errors    | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Source link                    | |
| | OpenAPI contract               | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Open operation index           | |
| | Opens details sheet            | |
| +--------------------------------+ |
| When opened                        |
| +--------------------------------+ |
| | Details sheet                  | |
| | +----------------------------+ | |
| | | Operation index            | | |
| | | Operations grouped by      | | |
| | | resource                   | | |
| | | Jump to operation          | | |
| | +----------------------------+ | |
| +--------------------------------+ |
+------------------------------------+
```

Derive groups and operation details from OpenAPI. This draft treats the page as reference content.

## Sign-in

`/sign-in` · MVP

**Desktop**

```text
+------------------------------------------------------------------------+
| +--------------------------------------------------------------------+ |
| | Authentication header                                              | |
| | Platfolio                                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Sign in to Platfolio                                               | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Sign-in form                                                       | |
| | Username or primary email                                          | |
| | Password | Sign in                                                 | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Account entry links                                                | |
| | Forgot password | Create account                                   | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| +--------------------------------+ |
| | Authentication header          | |
| | Platfolio                      | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Sign in to Platfolio           | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Sign-in form                   | |
| | Username or primary email      | |
| | Password | Sign in             | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Account entry links            | |
| | Forgot password | Create       | |
| | account                        | |
| +--------------------------------+ |
+------------------------------------+
```

Keycloak handles the themed authentication flow. [Callback](#callback) returns the person to the authorized destination.

## Sign-up

Prototype path `/sign-up`

**Desktop**

```text
+------------------------------------------------------------------------+
| +--------------------------------------------------------------------+ |
| | Authentication header                                              | |
| | Platfolio                                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Create an account                                                  | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Registration form                                                  | |
| | Username | Display name | Email                                    | |
| | New password | Confirm password                                    | |
| | Create account | Back to sign in                                   | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| +--------------------------------+ |
| | Authentication header          | |
| | Platfolio                      | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Create an account              | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Registration form              | |
| | Username | Display name |      | |
| | Email                          | |
| | New password | Confirm         | |
| | password                       | |
| | Create account | Back to sign  | |
| | in                             | |
| +--------------------------------+ |
+------------------------------------+
```

Registration continues to [Email verification](#email-verification) before the account opens.

## Password recovery

Prototype path `/forgot-password`

**Desktop**

```text
+------------------------------------------------------------------------+
| +--------------------------------------------------------------------+ |
| | Authentication header                                              | |
| | Platfolio                                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Reset your password                                                | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Recovery request                                                   | |
| | Primary email | Request reset link                                 | |
| | Back to sign in                                                    | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Request outcome (after submission)                                 | |
| | Check inbox | Try another address                                  | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| +--------------------------------+ |
| | Authentication header          | |
| | Platfolio                      | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Reset your password            | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Recovery request               | |
| | Primary email | Request reset  | |
| | link                           | |
| | Back to sign in                | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Request outcome (after         | |
| | submission)                    | |
| | Check inbox | Try another      | |
| | address                        | |
| +--------------------------------+ |
+------------------------------------+
```

The inbox link opens [Password reset](#password-reset). The prototype simulates opening that link.

## Password reset

Prototype path `/reset-password`

**Desktop**

```text
+------------------------------------------------------------------------+
| +--------------------------------------------------------------------+ |
| | Authentication header                                              | |
| | Platfolio                                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Choose a new password                                              | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Password form                                                      | |
| | New password | Confirm password                                    | |
| | Save new password | Cancel                                         | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| +--------------------------------+ |
| | Authentication header          | |
| | Platfolio                      | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Choose a new password          | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Password form                  | |
| | New password | Confirm         | |
| | password                       | |
| | Save new password | Cancel     | |
| +--------------------------------+ |
+------------------------------------+
```

An unavailable link offers a fresh request. A successful reset returns to Sign-in.

## Email verification

Prototype path `/verify-email`

**Desktop**

```text
+------------------------------------------------------------------------+
| +--------------------------------------------------------------------+ |
| | Authentication header                                              | |
| | Platfolio                                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Verify your email                                                  | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Verification request                                               | |
| | Target address | Verify email                                      | |
| | Return link                                                        | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| +--------------------------------+ |
| | Authentication header          | |
| | Platfolio                      | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Verify your email              | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Verification request           | |
| | Target address | Verify email  | |
| | Return link                    | |
| +--------------------------------+ |
+------------------------------------+
```

The verified signup continues to the workspace. Verification initiated from Account returns to the Emails tab.

## Callback

`/callback` · MVP

**Desktop**

```text
+------------------------------------------------------------------------+
| Callback document (empty view)                                         |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| Callback document (empty view)     |
+------------------------------------+
```

An empty transition performs the PKCE exchange. Success opens the requested dashboard route within the authenticated shell. A refused exchange returns to sign-in with a retry path. See D67 in the [decision register](../01-product-and-decisions.md#decision-register).
