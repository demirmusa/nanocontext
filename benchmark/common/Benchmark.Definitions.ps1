Set-StrictMode -Version Latest

$script:BenchmarkRepositories = @{
    "express" = @{
        Name = "express"
        Url = "https://github.com/expressjs/express.git"
        Language = "typescript"
        Include = @("lib/**/*.js", "test/**/*.js")
    }
    "nest" = @{
        Name = "nest"
        Url = "https://github.com/nestjs/nest.git"
        Language = "typescript"
        Include = @("packages/**/*.ts", "integration/**/*.ts", "sample/**/*.ts")
    }
    "dapper" = @{
        Name = "Dapper"
        Url = "https://github.com/DapperLib/Dapper.git"
        Language = "csharp"
        Include = @("Dapper/**/*.cs", "tests/**/*.cs")
    }
    "eshop" = @{
        Name = "eShop"
        Url = "https://github.com/dotnet/eShop.git"
        Language = "csharp"
        Include = @("src/**/*.cs")
    }
}

$script:BenchmarkTasks = @{
    "express-task1-trace" = @{
        Id = "express-task1-trace"
        Repository = "express"
        TaskKey = "task1-trace"
        Prompt = @"
Express's `res.redirect()` method handles both relative and absolute URLs. Trace the full code path of `res.redirect('/users')` from the moment it's called to the final HTTP response being sent. Show me every function involved, what file it's in, and what each step does.
"@
    }
    "express-task2-feature" = @{
        Id = "express-task2-feature"
        Repository = "express"
        TaskKey = "task2-feature"
        Prompt = @"
Add a `req.startedAt` property that records `Date.now()` when the request begins, and a `res.elapsed()` method that returns the milliseconds since `req.startedAt`. Implement this as built-in middleware that runs automatically for every request. Modify the necessary source files.
"@
    }
    "express-task3-understand" = @{
        Id = "express-task3-understand"
        Repository = "express"
        TaskKey = "task3-understand"
        Prompt = @"
How does Express's error handling work end-to-end? Find all the places where errors are caught, passed to `next(err)`, and ultimately handled. List every file and function involved in the error propagation chain.
"@
    }
    "nest-task1-trace" = @{
        Id = "nest-task1-trace"
        Repository = "nest"
        TaskKey = "task1-trace"
        Prompt = @"
Trace how a `@Get()` decorated controller method receives a request. Start from the HTTP server receiving the request, through the NestJS routing layer, middleware, guards, interceptors, pipes, and finally the controller method. Map every class and method involved with file locations.
"@
    }
    "nest-task2-feature" = @{
        Id = "nest-task2-feature"
        Repository = "nest"
        TaskKey = "task2-feature"
        Prompt = @"
Add a new `@Timeout(ms)` decorator for controller methods that automatically returns a 408 Request Timeout if the handler doesn't complete within the specified milliseconds. Implement it as a proper NestJS interceptor with decorator. Write the decorator, interceptor, and register it correctly.
"@
    }
    "nest-task3-understand" = @{
        Id = "nest-task3-understand"
        Repository = "nest"
        TaskKey = "task3-understand"
        Prompt = @"
Explain NestJS's dependency injection container implementation. How does `@Injectable()` register a class? How does the container resolve circular dependencies? Find the actual source files that implement the DI container, the resolution algorithm, and the scope handling (DEFAULT, REQUEST, TRANSIENT).
"@
    }
    "dapper-task1-trace" = @{
        Id = "dapper-task1-trace"
        Repository = "dapper"
        TaskKey = "task1-trace"
        Prompt = @"
Trace how `connection.QueryAsync<User>("SELECT * FROM Users WHERE Id = @Id", new { Id = 1 })` works internally. From the extension method call through SQL parameter binding, command execution, and object mapping back to a `User` instance. Map every class and method with file locations.
"@
    }
    "dapper-task2-feature" = @{
        Id = "dapper-task2-feature"
        Repository = "dapper"
        TaskKey = "task2-feature"
        Prompt = @"
Add a built-in `DateOnly` and `TimeOnly` type handler to Dapper so that these types work automatically without users having to register custom handlers. Implement the handlers and register them in the default type handler map.
"@
    }
    "dapper-task3-understand" = @{
        Id = "dapper-task3-understand"
        Repository = "dapper"
        TaskKey = "task3-understand"
        Prompt = @"
How does Dapper's object mapping work? When a SQL query returns columns, how does Dapper map them to C# object properties? Find the IL generation / emit code that creates the mapping function. Map every class and method involved with file locations.
"@
    }
    "eshop-task1-trace" = @{
        Id = "eshop-task1-trace"
        Repository = "eshop"
        TaskKey = "task1-trace"
        Prompt = @"
Trace the complete flow of placing an order in eShop. Start from the API endpoint that receives the order request, through validation, domain events, integration events, and database persistence. Map every service, handler, and event involved with file locations.
"@
    }
    "eshop-task2-feature" = @{
        Id = "eshop-task2-feature"
        Repository = "eshop"
        TaskKey = "task2-feature"
        Prompt = @"
Add a discount coupon feature to the Basket service. A coupon has a code (string) and a percentage discount (decimal). Add: 1) A coupon entity, 2) An endpoint to apply a coupon code to a basket, 3) Validation that the coupon exists and isn't expired, 4) Apply the discount when calculating basket totals.
"@
    }
    "eshop-task3-understand" = @{
        Id = "eshop-task3-understand"
        Repository = "eshop"
        TaskKey = "task3-understand"
        Prompt = @"
How does eShop implement the saga/process manager pattern for order processing? Find all integration events, event handlers, and state transitions involved in taking an order from 'submitted' to 'shipped'. Map the entire event flow across all microservices.
"@
    }
}

function Get-BenchmarkRepositoryDefinition {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if (-not $script:BenchmarkRepositories.ContainsKey($Name)) {
        throw "Unknown benchmark repository: $Name"
    }

    return $script:BenchmarkRepositories[$Name]
}

function Get-BenchmarkTaskDefinition {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Id
    )

    if (-not $script:BenchmarkTasks.ContainsKey($Id)) {
        throw "Unknown benchmark task: $Id"
    }

    return $script:BenchmarkTasks[$Id]
}

function Get-BenchmarkTaskIds {
    return @($script:BenchmarkTasks.Keys | Sort-Object)
}
